/* Simple text implementation of kansasui. */

function SimpleUI() {
    this.client = null;
}

(function() {  /* begin namespace simpleui */

var LOGLEVEL = 2;

SimpleUI.prototype.init = function(client) {
    this.client = client;
    $(".home-hidden").hide();
}

function textDump(client) {
    console.log("Rerendering entire client state.");
    $("body").html(JSON.stringify(client._game.state));
    var buf = "<p>Status: " + client._state + "</p><h1>Hands</h1>";
    var hands = client.listStacks('hands');
    for (i in hands) {
        var user = hands[i];
        var hand = client.getStack('hands', user);
        buf += "<h2>" + user + "</h2>";
        buf += JSON.stringify(hand);
    }
    buf += "<h1>Board</h1>";
    var stacks = client.listStacks('board');
    for (i in stacks) {
        var pos = stacks[i];
        var stack = client.getStack('board', pos);
        buf += "<h2>Stack " + pos + "</h2>";
        buf += JSON.stringify(stack);
    }
    $("body").html(buf);
}

SimpleUI.prototype.handleReset = function() {
    textDump(this.client);
}

SimpleUI.prototype.handleStackChanged = function(key) {
    console.log("Stack mutation @ " + key);
    textDump(this.client);
}

SimpleUI.prototype.handleBroadcast = function(data) {
    console.log("Broadcast: " + data);
}

SimpleUI.prototype.handlePresence = function(data) {
    console.log("Presence: " + data);
}

SimpleUI.prototype.showSpinner = function() {
    $("#spinner").show();
}

SimpleUI.prototype.hideSpinner = function() {
    $("#spinner").hide();
}

SimpleUI.prototype.vlog = function(level, msg) {
    if (level <= LOGLEVEL) {
        console.log("" + level + ": " + msg);
    }
}

SimpleUI.prototype.warning = function(msg) {
    console.log("WARNING: " + msg);
    textDump(this.client);
}

})();  /* end namespace simpleui */
