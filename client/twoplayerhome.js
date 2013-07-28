/* Home screen implementation that supports two-player games in general. */

/* XXX for exposing clients to world for debugging */
var clients = [];
var c0 = null;

function setupTwoPlayerHome(kansas_ui) {  /* begin setupTwoPlayerHome */

// Default settings for websocket connection.
var kWSPort = 8080
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);

// Datasource to use for finding cards.
var sourceid = 'magiccards.info';

// Global vars set by home screen, then used by init().
var gameid = "Unnamed Game";
var user = "Anonymous";

// Kansas client.
var client = null;
var prev_hash = "";

$("#clearerror").mouseup(function(e) {
    $("#error").hide();
    client && client.dropFutures();
    kansas_ui.hideSpinner();
});

$(window).bind('hashchange', function() {
    var next = document.location.hash.substr(1);
    console.log("prev hash: " + prev_hash);
    console.log("next hash: " + next);
    if (prev_hash == "" || next == "" || next == prev_hash) {
        console.log("ignoring hashchange");
    } else {
        prev_hash = document.location.hash;
        console.log("acting on hashchange");
        client && client._ws && client._ws.close();
    }
});

function enterGame() {
    $("#homescreen").fadeOut('slow');
    $(".home-hidden").fadeIn('slow');
    var orient;
    user = $("#username").val() || 'Undefined_User';
    if ($("#player1").is(":checked")) {
        orient = "player1";
    } else {
        orient = "player2";
    }
    document.title = 'Kansas: ' + orient + '@' + gameid;
    prev_hash = document.location.hash = user + ';' + orient + ';' + gameid;
    document.cookie = JSON.stringify({
        orient: orient,
        username: user,
    });

    kansas_ui.init(client, uuid, user, $("#player1").is(":checked"));

    client._state = 'opened_pending_connect';
    client.send("connect", {
        user: user,
        gameid: gameid,
        uuid: uuid,
    });
}

function handleError(msg) {
    if (msg == 'game terminated') {
        client.halted = true;
    }
    kansas_ui.warning("Server: " + msg);
}

function handleSocketOpen() {
    kansas_ui.clear();
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
        kansas_ui.vlog(3, "client: "  + client);
        client.callAsync("list_games").then(handleListGames);
    }
}

function handleSocketClose(client) {
    kansas_ui.warning("Connecting...");
    kansas_ui.hideSpinner();
    setTimeout(function() { client.connect(); }, 1000);
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
            var disabled = "";

            if (data[g].presence > 0) {
                online = " (" + data[g].presence + " online)";
                var disabled = " disabled=true ";
            }

            var button = "<button "
                + priv
                + "class='entergame' data-gameid='"
                + data[g].gameid
                + "'>"
                + "Join"
                + "</button>";

            var button2 = "<button "
                + priv
                + disabled + "class='endgame' data-gameid='"
                + data[g].gameid
                + "'>"
                + "End"
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
                + button2
                + "</div>"
            ).appendTo("#gamelist");
        }
    }
    setTimeout(function() {
        if (client._state == 'opened') {
            client.callAsync("list_games").then(handleListGames);
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
        kansas_ui.vlog(3, "could not parse cookie: " + document.cookie);
    }

    $("#gamename").val(new Date().toJSON());

    var scope = 'DEFAULT';
    var scopeset = false;
    var args = location.search.split("&");
    for (i in args) {
        var split = args[i].split("=");
        if (split[0].replace("?", "") == "scope") {
            scope = split[1].replace("/", "");
            scopeset = true;
        }
    }
    if (scopeset) {
        kansas_ui.vlog(0, "Setting scope to '" + scope + "'.");
        $("#scopetxt").text(scope);
        $("#scopechooser").hide();
        $("#homescreen").show();
    } else {
        $("#scopechooser").show();
        $("#homescreen").hide();
        return;
    }

    if (document.location.hash) {
        $("#homescreen").hide();
    }

    client = new KansasClient(hostname, kWSPort, kansas_ui, scope, sourceid)
        .bind('opened', handleSocketOpen)
        .bind('error', handleError)
        .bind('disconnected', function() { handleSocketClose(client); } )
        .bind('broadcast', function(x) { kansas_ui.handleBroadcast(x); })
        .bind('presence', function(x) { kansas_ui.handlePresence(x); })
        .bind('stackchanged', function(x) { kansas_ui.handleStackChanged(x); })
        .bind('reset', function(x) { kansas_ui.handleReset(x); })
        .bind('removed', function(x) { kansas_ui.handleRemove(x); })
        .bind('added', function(x) { kansas_ui.handleAdd(x); })
        .connect(scope);

    if (clients.length == 0)
        c0 = client;
    clients.push(client);

    $("#newgame").click(function() {
        if ($("#gamename").val())
            gameid = $("#gamename").val();
        enterGame();
    });

    $(".entergame").live('click', function(event) {
        gameid = $(event.currentTarget).data("gameid");
        enterGame();
    });

    $(".endgame").live('click', function(event) {
        var gid = $(event.currentTarget).data("gameid");
        if (confirm("Are you sure you want to end '" + gid + "'?")) {
            client.send("end_game", gid);
        }
    });
});

}  /* end setupTwoPlayerHome */
