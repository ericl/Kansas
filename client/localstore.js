/* Simple cookie k-v interface. */

var localstore = {};
var kCookieVersion = 10000;

localstore.put = function(key, value) {
    key += "_" + kCookieVersion;
    if (value === undefined) {
        $.removeCookie(key);
    } else {
        $.cookie(key, JSON.stringify(value));
    }
}

localstore.get = function(key, defaultValue) {
    key += "_" + kCookieVersion;
    var result = $.cookie(key);
    if (result === undefined) {
        return defaultValue;
    }
    return JSON.parse(result);
}
