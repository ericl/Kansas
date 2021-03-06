/* Home screen implementation that supports two-player games in general. */

/* XXX for exposing clients to world for debugging */
var clients = [];
var c0 = null;

function setupTwoPlayerHome(kansas_ui) {  /* begin setupTwoPlayerHome */

// Rebinds ctrl-f.
$(window).keydown(function(e){
    if ((e.ctrlKey || e.metaKey) && e.keyCode === 70) {
        e.preventDefault();
        kansas_ui._showDeckPanel();
    }
});

// Default settings for websocket connection.
var kWSPort = 8080
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);

// Global vars set by home screen, then used by init().
var gameid = "Unnamed Game";
var connect_info = null;

// Kansas client.
var client = null;
var prev_hash = "";

$("#clearerror").mouseup(function(e) {
    $("#error").hide();
    client && client.dropFutures();
    kansas_ui.hideSpinner();
});

var signed_on = false;

$(window).bind('hashchange', function() {
    var next = document.location.hash.substr(1);
    console.log("prev hash: " + prev_hash);
    console.log("next hash: " + next);
    if (prev_hash == "" || next == "" || next == prev_hash) {
        console.log("ignoring hashchange");
    } else {
        prev_hash = document.location.hash;
        console.log("acting on hashchange");
        signed_on = false;
        client && client._ws && client._ws.close();
    }
});

var kClientId = "8882673983-m7poir3vrdgjqeeavqh2i7jf7geeo2tk.apps.googleusercontent.com";

function enterGame(orient) {
    if (orient != "player1" && orient != "player2") {
        console.log("Reset invalid orient " + orient + " to player1.");
        orient = "player1";
    }
    var profile = localstore.get('profile');
    var profileReq = new Future();
    if (profile) {
        console.log("Using cached profile; run localstore.put('profile') to reset.");
        profileReq.done(profile);
    } else {
        kansas_ui.showSpinner("Logging in...");
        var immediateAuthReq = new Future();
        gapi.auth.authorize({
            client_id: kClientId,
            immediate: true,
            scope: "profile",
        }, immediateAuthReq.done.bind(immediateAuthReq));
        immediateAuthReq.then(function(authResult, context) {
            console.log("Auth result: " + JSON.stringify(authResult));
            if (authResult == null || !authResult.status.signed_in) {
                console.log("Retrying login with immediate = false.");
                gapi.auth.authorize({
                    client_id: kClientId,
                    immediate: false,
                    scope: "profile",
                }, context.retry);
                return context.Pending;
            } else {
                console.log("Immediate log in succeeded.");
                return authResult;
            }
        }).then(function(authResult) {
            if (signed_on) {
                console.log("Already signed on.");
                return;
            }
            signed_on = true;
            gapi.client.load('plus','v1', function() {
                kansas_ui.showSpinner("Almost done...");
                gapi.client.plus.people.get({
                    'userId': 'me'
                }).execute(profileReq.done.bind(profileReq));
            });
        });
    }
    profileReq.then(function(resp) {
        kansas_ui.hideSpinner();
        localstore.put('profile', resp);
        var user = resp.displayName;
        $("#homescreen").hide();
        $(".home-hidden").show();
        document.title = 'Kansas: ' + orient + '@' + gameid;
        prev_hash = document.location.hash = orient + ';' + gameid;
        localstore.put('orient', orient);

        kansas_ui.init(client, uuid, user, orient, gameid, resp.gender, resp.id);
        connect_info = {
            user: user,
            gameid: gameid,
            uuid: uuid,
            profile: resp,
            orient: orient,
        };

        client._state = 'opened_pending_connect';
        client.send("connect", connect_info);
    });
}

function handleRedirect(e) {
    alert(e.msg);
    document.location = e.url;
}

function handleError(msg) {
    kansas_ui.warning("Server: " + msg);
}

function handleSocketOpen() {
    kansas_ui.clear();
    if (document.location.hash) {
        var arr = document.location.hash.substr(1).split(';');
        gameid = arr[1] || "0";
        enterGame(arr[0]);
    } else {
        kansas_ui.vlog(3, "client: "  + client);
        client.callAsync("list_games").then(handleListGames);
    }
}

function handleSocketClose(client) {
    kansas_ui.showSpinner("Connecting...");
    console.log("WebSocket disconnected.");
    function connect_to_game() {
        if (connect_info != null) {
            client.send("connect", connect_info);
        }
    }
    setTimeout(function() { client.connect(connect_to_game); }, 1000);
}

var firstRun = true;
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

    if (needsRefresh || firstRun) {
        firstRun = false;
        $("#gamelist").empty();
        for (g in data) {
            var nodeid = "gnode_" + btoa(data[g].gameid).split("=")[0];
            var online = "";
            var name = data[g].gameid;
            var priv = "";
            var disabled = "";

            if (data[g].presence > 0) {
                online = " (" + data[g].presence + " online)";
//                var disabled = " disabled=true ";
            }
            var orients = {};
            for (k in data[g].orients) {
                orients[data[g].orients[k]] = true;
            }
            if (orients["player1"]) {
                var orient = "player2";
            } else {
                var orient = "player1";
            }

            var button = "<button "
                + priv
                + "class='entergame' data-gameid=\""
                + data[g].gameid + "\""
                + " data-suggested_orient=\""
                + orient
                + "\">"
                + "Join"
                + "</button>";

            var button2 = "<button "
                + priv
                + disabled + "class='endgame' data-gameid=\""
                + data[g].gameid
                + "\">"
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
        if ($(".entergame").size() > 0) {
            $(".entergame").first().focus();
        } else {
            $("#newgame").focus();
        }
    }
    var kMaxGames = 5;
    if (data.length >= kMaxGames) {
        $("#newgame").prop("disabled", true);
        $("#newgame").text("(Too Many Open Games)");
    } else {
        $("#newgame").prop("disabled", false);
        $("#newgame").text("New Game");
    }
    setTimeout(function() {
        if (client._state == 'opened') {
            client.callAsync("list_games").then(handleListGames);
        }
    }, 500);
}

$(document).ready(function() {
    $("#gamename").val(new Date().toJSON());

    $("#login").submit(function() {
        localstore.put('scope', $("#scopename").val());
        localstore.put('sourceid', $("select[name=sourceid]").val());
    });

    var scope = localstore.get('scope', 'DEFAULT');
    var sourceid = localstore.get('sourceid', 'localdb');
    var scopeset_URL = false;
    var sourceset_URL = false;
    var scopeset = false;
    var sourceset = false;
    var args = location.search.split("&");
    for (i in args) {
        var split = args[i].split("=");
        var key = split[0].replace("?", "");
        if (key) {
            var value = split[1].replace("/", "");
            if (key == "scope") {
                scopeset_URL = true;
                scope = value;
                scopeset = value;
            } else if (key == "sourceid") {
                sourceset_URL = true;
                sourceid = value;
                sourceset = value;
            }
        }
    }
    if (localstore.get('scope') !== false) {
        scopeset = true;
    }
    if (localstore.get('sourceid') !== false) {
        sourceset = true;
    }
    if (scopeset && sourceset) {
        kansas_ui.vlog(0, "Setting scope to '" + scope + "'.");
        kansas_ui.vlog(0, "Setting sourceid to '" + sourceid + "'.");
        if (!sourceset_URL || !scopeset_URL) {
            if (window.history && window.history.pushState) {
                window.history.pushState(null, null,
                    '?scope=' + scope + '&sourceid=' + sourceid + '/');
            }
        }
        $("#scopetxt").text(scope);
        $("#sourceidtxt").text(sourceid);
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
        .bind('redirect', handleRedirect)
        .bind('disconnected', function() { handleSocketClose(client); } )
        .bind('broadcast', function(x) { kansas_ui.handleBroadcast(x); })
        .bind('presence', function(x) { kansas_ui.handlePresence(x); })
        .bind('stackchanged', function(x) { kansas_ui.handleStackChanged(x); })
        .bind('reset', function(x) { kansas_ui.handleReset(x); })
        .bind('removed', function(x) { kansas_ui.handleRemove(x); })
        .bind('added', function(x) { kansas_ui.handleAdd(x); })
        .connect();

    if (clients.length == 0)
        c0 = client;
    clients.push(client);

    $("#newgame").click(function() {
        if ($("#gamename").val())
            gameid = $("#gamename").val();
        enterGame("player1");
    });

    $("#logout").click(function() {
        localstore.put('scope', false);
        localstore.put('sourceid', false);
    });

    $(".entergame").live('click', function(event) {
        var button = $(event.currentTarget)
        gameid = button.data("gameid");
        enterGame(button.data("suggested_orient"));
    });

    $(".endgame").live('click', function(event) {
        var gid = $(event.currentTarget).data("gameid");
        if (confirm("Are you sure you want to end '" + gid + "'?")) {
            client.send("end_game", gid);
        }
    });
});

}  /* end setupTwoPlayerHome */
