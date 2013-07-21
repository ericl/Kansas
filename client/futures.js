/**
 * A simple implementation of Futures in javascript.
 * 
 *  Usage:
 *      var fut1 = Future();
 *      var fut2 = fut1.then(function(v) {
 *          return v * 2;
 *      });
 *      var fut3 = fut2.then(function(v) {
 *          console.log(v + 10);
 *      });
 *      fut1.complete(4);
 *      >> 18
 *      fut3.state;
 *      >> 'completed'
 */

function Future() {
    this.result = null;
    this.state = 'pending';
    this._oncomplete = null;
}


(function() {  /* begin namespace futures */

/**
 * When this future completes, execute the given _oncomplete on the result.
 * Returns another future on the result of the _oncomplete given.
 */
Future.prototype.then = function(callback) {
    if (this._oncomplete !== null) {
        throw "callback already set for this future.";
    }

    var child = new Future();
    this._oncomplete = function(v) {
        child.complete(callback(v));
    };

    if (this.state == 'completed') {
        this._oncomplete(this.result);
    }

    return child;
}

/**
 * Called on this future when the pending computation is completed.
 */
Future.prototype.complete = function(result) {
    if (this.state == 'completed') {
        throw "This future has already completed.";
    }

    this.result = result;
    if (this._oncomplete !== null) {
        this._oncomplete(result);
    }

    this.state = 'completed';
}

})();  /* end namespace futures */
