/* Simple cookie k-v interface. */

var localstore = {};

localstore._load = function() {
    try {
        return JSON.parse(document.cookie);
    } catch (err) {
        return {};
    }
}

localstore._save = function(dict) {
    document.cookie = JSON.stringify(dict);
}

localstore.put = function(key, value) {
    var dict = localstore._load();
    dict[key] = value;
    localstore._save(dict);
}

localstore.get = function(key, defaultValue) {
    var dict = localstore._load();
    var result = dict[key];
    if (!result) {
        result = defaultValue;
    }
    return result;
}
