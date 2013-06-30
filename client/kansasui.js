/* Manages card rendering and user input / output.
 *
 * Defined methods for 'kansas_ui' module:
 *
 *      kansas_ui.init(client: KansasClient, uuid: str, isPlayer1: bool)
 *          Called when the client has been connected to a game.
 *          No new methods should be bound to the client by kansasui.
 *
 *      kansas_ui.handleReset()
 *      kansas_ui.handleStackChanged(key: [str, str|int])
 *      kansas_ui.handleBroadcast(data: json)
 *      kansas_ui.handlePresence(data: json)
 *      kansas_ui.showSpinner()
 *      kansas_ui.hideSpinner()
 *      kansas_ui.log(msg)
 *      kansas_ui.warning(msg)
 */

function KansasUI() {};

(function() {  /* begin namespace kansasui */

KansasUI.prototype.init = function(client, uuid, isPlayer1) {
    alert("kansas ui init " + uuid + " " + isPlayer1);
};

KansasUI.prototype.handleReset = function() {
};

KansasUI.prototype.handleStackChanged = function(key) {
    var dest_t = key[0];
    var dest_k = key[0];
};

KansasUI.prototype.handleBroadcast = function(data) {
};

KansasUI.prototype.handlePresence = function(data) {
};

KansasUI.prototype.showSpinner = function() {
};

KansasUI.prototype.hideSpinner = function() {
};

KansasUI.prototype.warning = function(msg) {
    console.log("WARNING: " + msg);
};

KansasUI.prototype.log = function(msg) {
    console.log(msg);
};

})();  /* end namespace kansasui */
