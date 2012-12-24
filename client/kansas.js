/**
 * The client provides an eventually-consistent view of the game state.
 * Synchronization works as follows. When the user moves a card, a "move"
 * message is sent to the server. This "move" is immediately applied locally.
 * The server then relays the move to all clients in a globally consistent order
 * relative to other moves.
 *
 * Clients, upon receiving an "update" message, will update the local state of
 * the card mentioned in the update. Once all clients have received the update,
 * all the client states will be in sync.
 *
 * The client can also talk to all other clients by using a "broadcast" message,
 * which again will be received by other clients in a globally consistent order.
 */

var activeCard = null;
var dragging = false;
var grid = 75;
var delta = 2;
var ws = null;
var hostname = window.location.hostname || "localhost"
var wsport = 8080
var ctr = 0;
var user = "testuser1";
var gameid = "testgame1";
var phantom_dest = 0;
var uuid = "p_" + Math.random().toString().substring(5);
var resource_prefix = '';
var loggingEnabled = false;

function log(msg) {
    if (loggingEnabled) {
        var console = $('#console');
        console.append(msg + "\n");
        console.scrollTop(console[0].scrollHeight - console.height());
    }
}

// http://stackoverflow.com/questions/5186441/javascript-drag-and-drop-for-touch-devices
// TODO find a more robust solution that supports hold touch, taps, and double taps.
function touchHandler(event) {
    var touches = event.changedTouches,
    first = touches[0],
    type = "";

    switch (event.type) {
        case "touchstart": type="mousedown"; break;
        case "touchmove": type="mousemove"; break;
        case "touchend": type="mouseup"; break;
        default: return;
    }

    var simulatedEvent = document.createEvent("MouseEvent");
    simulatedEvent.initMouseEvent(type, true, true, window, 1,
                                  first.screenX, first.screenY,
                                  first.clientX, first.clientY, false,
                                  false, false, false, 0/*left*/, null);

    first.target.dispatchEvent(simulatedEvent);
    event.preventDefault();
}

function touchInit() {
   document.addEventListener("touchstart", touchHandler, true);
   document.addEventListener("touchmove", touchHandler, true);
   document.addEventListener("touchend", touchHandler, true);
   document.addEventListener("touchcancel", touchHandler, true);
}

function getOrient(card) {
    var orient = card.data("orient");
    if (orient == 0) {
        orient = 1;
    }
    return orient;
}

function setOrientProperties(card, orient) {
    card.data("orient", orient);
    if (orient > 0) {
        card.prop("src", resource_prefix + card.data("front"));
    } else {
        card.prop("src", resource_prefix + card.data("back"));
    }

    if (Math.abs(orient) == 2) {
        card.addClass("rotated");
    } else {
        card.removeClass("rotated");
    }
}

function changeOrient(card, orient) {
    setOrientProperties(card, orient);

    var offset = card.offset();
    var cardId = parseInt(card.prop("id").substr(5));
    var dest_x = parseInt((offset.left + grid/2) / grid) * grid;
    var dest_y = parseInt((offset.top + grid/2) / grid) * grid;
    var dest_key = ((offset.left + grid/2) / grid) |
                   ((offset.top + grid/2) / grid) << 16;
    ws.send("broadcast",
        {
            "subtype": "phantomupdate",
            "hide": false,
            "uuid": uuid,
            "name": user,
            "left": dest_x,
            "top": dest_y,
            "orient": getOrient(card),
            "width": card.width(),
            "height": card.height()
        });
    ws.send("move", {move: {card: cardId,
                            dest_type: "board",
                            dest_key: dest_key,
                            dest_orient: orient}});
    ws.send("broadcast",
        {
            "subtype": "phantomupdate",
            "hide": true,
            "uuid": uuid,
        });
}

function rotateCard(target) {
    var orient = getOrient(target);
    if (Math.abs(orient) == 1) {
        orient *= 2;
    } else if (Math.abs(orient) == 2) {
        orient /= 2;
    } else {
        log("Card is not in supported orientation: at " + orient);
        return;
    }
    changeOrient(target, orient);
}

function flipCard(target) {
    changeOrient(target, -getOrient(target));
}

function showMenuAtCard(card) {
    var offset = card.offset();
    $("#menu").hide();
    $("#menu").css("left", offset.left);
    $("#menu").css("top", offset.top);
    $("#menu").show();
}

$(document).ready(function() {
    touchInit();
    var connected = false;

    function initCards() {
        $(".card").each(function(index, card) {
            setOrientProperties($(card), getOrient($(card)));
        });
        $(".card").draggable({stack: ".card"});
        $(".card").bind("dragstart", function(event, ui) {
            dragging = true;
            $("#menu").hide();
            var target = $(event.currentTarget);
            var offset = target.offset();
            var card = target.prop("id");
            ws.send("broadcast", {"subtype": "dragstart", "card": card});
            var dest_x = parseInt((offset.left + grid/2) / grid) * grid;
            var dest_y = parseInt((offset.top + grid/2) / grid) * grid;
            var phantom = $("#phantom");
            setOrientProperties(phantom, getOrient(target));
            phantom.width(target.width());
            phantom.height(target.height());
            phantom.css("left", dest_x);
            phantom.css("top", dest_y);
            phantom.css("z-index", target.css("zIndex") - 1);
            phantom.show();
            phantom_dest = 0;
        });
        $(".card").bind("drag", function(event, ui) {
            dragging = true;
            var target = $(event.currentTarget);
            var offset = target.offset();
            var dest_x = parseInt((offset.left + grid/2) / grid) * grid;
            var dest_y = parseInt((offset.top + grid/2) / grid) * grid;
            var dest_key = dest_x | dest_y << 16;
            if (dest_key != phantom_dest) {
                phantom_dest = dest_key;
                ws.send("broadcast",
                    {
                        "subtype": "phantomupdate",
                        "hide": false,
                        "uuid": uuid,
                        "name": user,
                        "left": dest_x,
                        "top": dest_y,
                        "orient": getOrient(target),
                        "width": target.width(),
                        "height": target.height()
                    });
            }
        });
        $(".card").bind("dragstop", function(event, ui) {
            dragging = false;
            $("#phantom").fadeOut();
            ws.send("broadcast",
                {
                    "subtype": "phantomupdate",
                    "hide": true,
                    "uuid": uuid,
                });
            var target = $(event.currentTarget);
            var offset = target.offset();
            var card = parseInt(target.prop("id").substr(5));
            var orient = target.data("orient");
            var dest_key = ((offset.left + grid/2) / grid) |
                           ((offset.top + grid/2) / grid) << 16;
            ws.send("move", {move: {card: card,
                                    dest_type: "board",
                                    dest_key: dest_key,
                                    dest_orient: orient}});
        });

        $(".card").mouseup(function(event) {
            if (!dragging) {
                activeCard = $(event.currentTarget);
                showMenuAtCard(activeCard);
            }
            dragging = false;
        });
        $("#menu").disableSelection();
        $("#hidemenu").mouseup(function(event) {
            $("#menu").hide();
        });
        $("#flip").mouseup(function(event) {
            flipCard(activeCard);
            $("#menu").hide();
        });
        $("#rotate").mouseup(function(event) {
            rotateCard(activeCard);
            $("#menu").hide();
        });
    }

    function reset(state) {
        log("Reset all local state.");
        $(".uuid_phantom").remove();
        $(".card").remove();
        $("#arena").hide();
        for (pos in state.board) {
            var stack = state.board[pos];
            for (z in stack) {
                var cid = stack[z];
                var x = (pos & 0xffff) * grid;
                var y = (pos >> 16) * grid;
                var url = state.urls[cid];
                var back_url = state.back_urls[cid] || state.default_back_url;
                resource_prefix = state.resource_prefix;
                if (state.orientations[cid] < 0) {
                    url = back_url;
                }
                var img = '<img style="z-index: ' + state.zIndex[cid]
                    + '; left: ' + (x + (z * delta)) + 'px'
                    + '; top: ' + (y + (z * delta)) + 'px'
                    + '" id="card_' + cid + '"'
                    + ' data-orient="' + state.orientations[cid] + '"'
                    + ' data-front="' + state.urls[cid] + '"'
                    + ' data-back="' + back_url + '"'
                    + ' class="card" src="' + resource_prefix + url + '">'
                $("#arena").append(img);
            }
        }
        $("#arena").fadeIn();
        initCards();
    }

    ws = $.websocket("ws:///" + hostname + ":" + wsport + "/kansas", {
        open: function() { alert("open"); },
        close: function() { alert("close"); },
        events: {
            connect_resp: function(e) {
                log("Connected: " + e.data);
                $("#connect").hide();
                $(".connected").show();
                reset(e.data[0]);
            },
            resync_resp: function(e) {
                reset(e.data[0]);
            },
            broadcast_resp: function(e) {
                log("broadcast ack: " + e.data);
            },
            error: function(e) {
                log("Error: " + e.msg);
            },
            update: function(e) {
                log("Update: " + JSON.stringify(e.data));
                var lz = e.data.z_stack.length - 1;
                var x = (e.data.move.dest_key & 0xffff) * grid;
                var y = (e.data.move.dest_key >> 16) * grid;
                for (i in e.data.z_stack) {
                    if (i == e.data.z_stack.length - 1) {
                        continue; // allow the last element to animate
                    }
                    $("#card_" + e.data.z_stack[i]).css("left", x + i * delta);
                    $("#card_" + e.data.z_stack[i]).css("top", y + i * delta);
                }
                var target = $("#card_" + e.data.move.card);
                target.css("opacity", "1.0");
                target.css("z-index", e.data.z_index);
                target.animate({
                    left: x + lz * delta,
                    top: y + lz * delta,
                }, 'fast');
                setOrientProperties(target, e.data.move.dest_orient);
            },
            broadcast_message: function(e) {
                switch (e.data.subtype) {
                    case "dragstart":
                        $("#" + e.data.card).css("opacity", "0.7");
                        break;
                    case "phantomupdate":
                        var phantom = $("#" + e.data.uuid);
                        if (phantom.length == 0) {
                            var node = '<div class="uuid_phantom" id="' + e.data.uuid + '" style="position: absolute; border: 3px solid orange; pointer-events: none; border-radius: 5px; z-index: 999999; font-size: small;"><span style="background-color: orange; padding-right: 2px; padding-bottom: 2px; border-radius: 2px; color: white; margin-top: -2px !important; margin-left: -1px;">' + e.data.name + '</span></div>';
                            $("#arena").append(node);
                            phantom = $("#" + e.data.uuid);
                        }
                        if (e.data.hide) {
                            phantom.fadeOut();
                        } else {
                            setOrientProperties(phantom, e.data.orient);
                            phantom.width(e.data.width - 6);
                            phantom.height(e.data.height - 6);
                            phantom.css("left", e.data.left);
                            phantom.css("top", e.data.top);
                            phantom.show();
                        }
                        break;
                }
                log("Broadcast: " + JSON.stringify(e));
            },
            _default: function(e) {
                log("Unknown response: " + JSON.stringify(e));
            },
        },
    });

    function requireConnect() {
        if (!connected) {
            ws.send("connect", {user: user, gameid: gameid});
            connected = true;
        }
    }

    $("#connect").click(function(e) {
        requireConnect();
    });

    $("#sync").click(function(e) {
        ws.send("resync");
    });

    $("#debug").click(function(e) {
        $("#console").show();
        loggingEnabled = true;
    });

    setTimeout(requireConnect, 1000);
});

// vim: et sw=4
