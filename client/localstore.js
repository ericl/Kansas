/* Simple cookie k-v interface. */

var localstore = {};

localstore.put = function(key, value) {
    $.cookie(key, value);
}

localstore.get = function(key, defaultValue) {
    var result = $.cookie(key);
    if (result === undefined || result === null) {
        return defaultValue;
    }
    return result;
}
