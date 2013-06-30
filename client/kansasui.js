/* Manages card rendering and user input / output.
 *
 * Required methods for 'kansas_ui' module:
 *      kansas_ui.init(client: KansasClient, uuid: str, isPlayer1: bool)
 *      kansas_ui.handleReset()
 *      kansas_ui.handleStackChanged(key: [str, str|int])
 *      kansas_ui.handleBroadcast(data: json)
 *      kansas_ui.handlePresence(data: json)
 *      kansas_ui.showSpinner()
 *      kansas_ui.hideSpinner()
 *      kansas_ui.log(msg)
 *      kansas_ui.warning(msg)
 */

var kansas_ui = new Object();
var dbg = null; /* Exposes kansas client for debugging. */

(function() {  /* begin namespace kansasui */

    kansas_ui.init = function(client, uuid, isPlayer1) {
        dbg = client;
        alert("kansas ui init " + uuid + " " + isPlayer1);
    };

    kansas_ui.handleReset = function() {
    };

    kansas_ui.handleStackChanged = function(key) {
        var dest_t = key[0];
        var dest_k = key[0];
    };

    kansas_ui.handleBroadcast = function(data) {
    };

    kansas_ui.handlePresence = function(data) {
    };

    kansas_ui.showSpinner = function() {
    };

    kansas_ui.hideSpinner = function() {
    };

    kansas_ui.warning = function(msg) {
        console.log("WARNING: " + msg);
    };

    kansas_ui.log = function(msg) {
        console.log(msg);
    };

})();  /* end namespace kansasui */
