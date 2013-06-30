/* Demo app exercising kclient and kview. To replace kansas.js eventually. */

// Default settings for websocket connection.
var kWSPort = 8080
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);

// Global vars set by home screen, then used by init().
var gameid = "Unnamed Game";
var user = "Anonymous";
var hand_user = "Player 1";

// Kansas client.
var client = null;
var view = null;

// Geometry of cards.
var kCardWidth = 92;
var kCardHeight = 131;
var kCardBorder = 4;
var kRotatedOffsetLeft = -10;
var kRotatedOffsetTop = 25;
var kMinHandHeight = 90;
var kHoverCardRatio = 3.95;
var kHoverTapRatio = kHoverCardRatio * 0.875;
var kSelectionBoxPadding = 15;
var kMinSupportedHeight = 1000;

/* Logs a message to the debug console */
function log(msg) {
    console.log(msg);
}

/* Logs warning to debug console */
function warning(msg) {
    console.log(msg);
    if (!$("#error").is(":visible")) {
        $("#error").text(msg).show();
    }
}

/* Shows the "Loading..." spinner. */
var spinnerShowQueued = false;
function showSpinner() {
    if (!spinnerShowQueued && !disconnected) {
        spinnerShowQueued = true;
        setTimeout(_reallyShowSpinner, 500);
    }
}

function _reallyShowSpinner() {
    if (spinnerShowQueued && !disconnected) {
        $("#spinner").show();
        spinnerShowQueued = false;
    }
}

/* Hides the "Loading..." spinner. */
function hideSpinner() {
    spinnerShowQueued = false;
    $("#spinner").hide();
}

function enterGame() {
    $("#homescreen").fadeOut('slow');
    $(".home-hidden").fadeIn('slow');
    var orient;
    user = $("#username").val();
    if ($("#player1").is(":checked")) {
        orient = "player1";
        hand_user = "Player 1";
        view = KansasView(client, 0, [0, 0]);
    } else {
        orient = "player2";
        hand_user = "Player 2";
        view = KansasView(client, 2, [-kCardWidth, -kCardHeight]);
    }
    document.title = user + ';' + orient + ';' + gameid;
    document.location.hash = document.title;
    document.cookie = JSON.stringify({
        orient: orient,
        username: user,
    });

    /* Enforces that this function is only run once. */
    enterGame = function() {};
    client.send("connect", {
        user: user,
        gameid: gameid,
        uuid: uuid,
    });
};

function handleSocketOpen() {
    if (document.location.hash) {
        var arr = document.location.hash.split(';');
        user = arr[0].substr(1);
        $("#username").val(user);
        gameid = arr[2];
        if (arr[1] == "player1")
            $("#player1").prop("checked", true);
        else if (arr[1] == "player2")
            $("#player2").prop("checked", true);
        enterGame();
    } else {
        log("client: "  + client);
        client.send("list_games");
    }
}

function handleSocketClose() {
    warning("Connection Error.");
    hideSpinner();
}

function handleReset() {
    alert("TODO: reset card state");
}

function handleStackChanged(key) {
    var stack_t = key[0];
    var stack_k = key[1];
    console.log("stack redraw @ " + stack_t + ", " + stack_k);
}

function handleListGames(data) {
    $("#gamelist_loading").hide();

    /* Avoids annoyance of buttons disappearing on unneeded refresh. */
    var needsRefresh = false;
    for (g in data) {
        var nodeid = "#gnode_" + btoa(data[g].gameid).split("=")[0];
        var node = $(nodeid);
        if (!node || node.data("presence") != data[g].presence) {
            needsRefresh = true;
            break;
        }
    }
    if ($(".gameonline").length != data.length) {
        needsRefresh = true;
    }

    if (needsRefresh) {
        $("#gamelist").empty();
        for (g in data) {
            var nodeid = "gnode_" + btoa(data[g].gameid).split("=")[0];
            var online = "";
            var name = data[g].gameid;
            var priv = "";

            if (data[g].private) {
                name = "<i>Private Game " + data[g].gameid + "</i>"
                priv = "disabled "
            }

            if (data[g].presence > 0) {
                online = " (" + data[g].presence + " online)";
            }

            var button = "<button "
                + priv
                + "class='entergame' data-gameid='"
                + data[g].gameid
                + "'>"
                + "Join"
                + "</button>";

            var node = $("<div id='"
                + nodeid
                + "' class='gamechoice gameonline' data-presence="
                + data[g].presence
                + "><span>"
                + name
                + online
                + "</span> "
                + button
                + "</div>"
            ).appendTo("#gamelist");
        }
    }
    setTimeout(function() {
        if (client._state == 'opened') {
            client.send("list_games");
        }
    }, 500);
}

$(document).ready(function() {

    try {
        var config = JSON.parse(document.cookie);
        if (config.orient == "player2") {
            $("#player2").prop("checked", true);
        }
        if (config.username) {
            $("#username").val(config.username);
        }
    } catch (err) {
        log("could not parse cookie: " + document.cookie);
    }

    $("#gamename").val(new Date().toJSON());

    if (document.location.hash) {
        $("#homescreen").hide();
    }

    client = new KansasClient(hostname, kWSPort)
        .bind('opened', handleSocketOpen)
        .bind('disconnected', handleSocketClose)
        .bind('listgames', handleListGames)
        .bind('stackchanged', handleStackChanged)
        .bind('reset', handleReset)
        .connect();

    $("#newgame").click(function() {
        if ($("#gamename").val())
            gameid = $("#gamename").val();
        if ($("#private").is(":checked"))
            gameid += "@private_" + uuid;
        enterGame();
    });

    $(".entergame").live('click', function(event) {
        gameid = $(event.currentTarget).data("gameid");
        enterGame();
    });
});
