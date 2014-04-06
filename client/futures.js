/**
 * A simple implementation of Futures in javascript.
 * 
 *  Usage:
 *      var fut1 = UI.showNonModalPrompt("What is your name?");
 *      fut1.then(function(name, context) {
 *          if (name == null) {
 *              return "Illegal login name: " + v;
 *          } else {
 *              $.ajax("loginWithName", name, context.done);
 *              return context.Pending;
 *          }
 *      }).then(function(v) {
 *          console.log("Login result is: " + v);
 *      });
 *      fut1.done("Alice");
 *      >> Login result is: hello Alice, you are now logged in.
 */

function Future() {
    this._state = 'pending';
    this._oncomplete = undefined;
    this._result = undefined;
}

(function() {  /* begin namespace futures */

/**
 * When this future completes, runs callback with the computed result.
 * @param callback: Called when this future is completed.
 * @return Future on the optional result of the callback.
 *
 * Callback takes two optional arguments:
 *  value: The value this future was completed with.
 *  context: Object with two methods: done(val) and retry(val).
 *
 * If the return value of callback is not context.Pending, context.done will
 * be called on the returned value of callback.
 *
 * Using the done and retry methods, it is possible to express complex work
 * flows using Futures while avoiding nested callbacks. For example, consider
 * this login flow example:
 * 
 * UI.showNonModalPrompt("What is your name?")
 *   .then(function(name, context) {
 *       if (name) {
 *           return name;
 *       } else if (autoSuggestNamesEnabled) {
 *           $.ajax("getRandomName", context.done);
 *           return context.Pending;
 *       } else {
 *           $.showNonModalPrompt("Try again. Your name?").then(context.retry);
 *           return context.Pending;
 *       }
 *   }).then(function(name) { console.log("Login result: " + name));
 */
Future.prototype.then = function(callback) {
    if (this._oncomplete !== undefined) {
        throw "callback already set for this future.";
    }
    var child = new Future();
    var that = this;
    var context = {
        done: function(value) { child.done(value); },
        retry: function(value) { that._oncomplete(value); },
        Pending: Object(),
    };
    this._oncomplete = function(value) {
        var result = callback(value, context);
        if (result !== context.Pending) {
            context.done(result);
        }
    };
    if (this._state == 'completed') {
        this._oncomplete(this._result);
    }
    return child;
}

/**
 * Called on this future when the pending computation is completed.
 */
Future.prototype.done = function(result) {
    if (this._state == 'completed') {
        throw "This future has already completed.";
    }
    this._result = result;
    if (this._oncomplete !== undefined) {
        this._oncomplete(result);
    }
    this._state = 'completed';
}

})();  /* end namespace futures */
