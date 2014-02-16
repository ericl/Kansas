/**
 * A simple implementation of Futures in javascript.
 * 
 *  Usage:
 *      var fut1 = UI.showNonModalPrompt("What is your name?");
 *
 *      fut1.then(function(v, continueWith) {
 *          if (v == null) {
 *              continueWith("Illegal login name: " + v);
 *          } else {
 *              $.ajax(v, ...).done(continueWith);
 *          }
 *      }).then(function(v) {
 *          console.log("Login result is: " + v);
 *      });
 *
 *      fut1.set("Alice");
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
 * Callback takes three optional arguments:
 *  value: The value this future was completed with.
 *  continueWith: Function that completes the returned future with its first argument.
 *  retryWith: Function that retries this callback with its first argument.
 *
 * Using continueWith and retryWith, it is possible to express complex work flows
 * using Futures while avoiding nested callbacks. For example, consider this
 * login flow example:
 * 
 * UI.showNonModalPrompt("What is your name?")
 *   .then(function(v, continueWith, retryWith) {
 *       if (v) {
 *           $.ajax(v, ...).done(continueWith);
 *       } else {
 *           $.showNonModalPrompt("Try again. Your name?").then(retryWith);
 *       }
 *   }).then(function(v) { console.log("Login result: " + v));
 */
Future.prototype.then = function(callback) {
    if (this._oncomplete !== undefined) {
        throw "callback already set for this future.";
    }
    var child = new Future();
    this._oncomplete = function(value) {
        function retryWith(newValue) {
            callback(newValue, child.set.bind(child), retryWith);
        }
        callback(value, child.set.bind(child), retryWith);
    };
    if (this.state == 'completed') {
        this._oncomplete(this.result);
    }
    return child;
}

/**
 * Called on this future when the pending computation is completed.
 */
Future.prototype.set = function(result) {
    if (this.state == 'completed') {
        throw "This future has already completed.";
    }
    this.result = result;
    if (this._oncomplete !== undefined) {
        this._oncomplete(result);
    }
    this.state = 'completed';
}

})();  /* end namespace futures */
