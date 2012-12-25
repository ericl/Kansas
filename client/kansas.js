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

var kGridSpacing = 75;
var kWSPort = 8080

var hostname = window.location.hostname || "localhost"
var gameid = "testgame1";
var uuid = "p_" + Math.random().toString().substring(5);
var user = window.location.hash || "#alice";
document.title = user + '@' + gameid;

var ws = null;
var activeCard = null;
var menuReady = false;
var handCache = [];
var XXX_jitter = 1;
var dragging = false;
var skipCollapse = false;
var lastPhantomLocation = 0;
var startPhantomLocation = 0;
var resourcePrefix = '';
var loggingEnabled = false;

function heightOf(stackHeight) {
    if (stackHeight > 1000000) {
        return 0;
    }
    var kStackDelta = 2;
    var kMaxVisibleStackHeight = 9;
    if (stackHeight > kMaxVisibleStackHeight) {
        stackHeight = kMaxVisibleStackHeight;
    }
    return stackHeight * kStackDelta;
}

function removeFromArray(arr, item) {
    var idx = $.inArray(item, arr);
    if (idx >= 0) {
        arr.splice(idx, 1);
        log("Removing item " + item + " from array.");
        return true;
    } else {
        log("Item " + item + " not in array.");
        return false;
    }
}

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
        card.prop("src", resourcePrefix + card.data("front"));
    } else {
        card.prop("src", resourcePrefix + card.data("back"));
    }

    if (Math.abs(orient) == 2) {
        card.addClass("rotated");
    } else {
        card.removeClass("rotated");
    }
}

function gridX(card) {
    var offset = card.offset();
    var left = offset.left;
    return parseInt((left + kGridSpacing/2) / kGridSpacing) * kGridSpacing;
}

function gridY(card) {
    var offset = card.offset();
    var tp = offset.top;
    if (card.hasClass("rotated")) {
        tp -= parseInt(card.css("margin-top"));
    }
    return parseInt((tp + kGridSpacing/2) / kGridSpacing) * kGridSpacing;
}

function gridKey(x, y) {
    return ((x + kGridSpacing/2) / kGridSpacing) |
           ((y + kGridSpacing/2) / kGridSpacing) << 16;
}

function targetToGridKey(target) {
    return gridKey(gridX(target), gridY(target));
}

function phantomUpdate(card, entireStack) {
    if (card.hasClass("inHand")) {
        return;
    }
    var stack_height = heightOf(card.data("stack_index"));
    if (entireStack) {
        var x = gridX(card);
        var y = gridY(card);
        var w = card.width() + stack_height;
        var h = card.height() + stack_height;
    } else if (startPhantomLocation == targetToGridKey(card)) {
        var x = gridX(card) + stack_height;
        var y = gridY(card) + stack_height;
        var w = card.width();
        var h = card.height();
    } else {
        var x = gridX(card);
        var y = gridY(card);
        var w = card.width();
        var h = card.height();
    }
    ws.send("broadcast",
        {
            "subtype": "phantomupdate",
            "hide": false,
            "uuid": uuid,
            "name": user,
            "left": x,
            "top": y,
            "orient": getOrient(card),
            "width": w,
            "height": h,
        });
}

function phantomDone() {
    ws.send("broadcast",
        {
            "subtype": "phantomupdate",
            "hide": true,
            "uuid": uuid,
        });
}

function changeOrient(card, orient) {
    setOrientProperties(card, orient);
    phantomUpdate(card);

    var cardId = parseInt(card.prop("id").substr(5));
    var dest_type = "board";
    var dest_prev_type = "board";
    var dest_key = targetToGridKey(card);
    if (card.hasClass("inHand")) {
        dest_type = "hands";
        dest_key = user;
        dest_prev_type = "hands";
    }
    log("Sending orient change.");
    ws.send("move", {move: {card: cardId,
                            dest_type: dest_type,
                            dest_key: dest_key,
                            dest_prev_type: dest_type,
                            dest_orient: orient}});
    phantomDone();
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

function zoomCard(target) {
    var old = $(".zoomed");
    $(".zoomed").fadeOut(function() { old.remove(); });

    var imgNode = '<img src="' + target.prop("src") + '" class="zoomed"></img>'
    $("#arena").append(imgNode);
    if (window.innerHeight > window.innerWidth) {
        $(".zoomed").width("60%");
    } else {
        $(".zoomed").height("60%");
    }
    $(".zoomed").css("margin-left", - ($(".zoomed").width() / 2));
    $(".zoomed").css("margin-top", - ($(".zoomed").height() / 2));
    $(".zoomed").fadeIn();
}

function flipCard(target) {
    changeOrient(target, -getOrient(target));
}

function flipStack(target) {
    if (target.hasClass("inHand")) {
        flipCard(target);
        return;
    }
    var dest_key = targetToGridKey(target);
    phantomUpdate(target, true);
    ws.send("stackop", {op_type: "reverse",
                        dest_type: "board",
                        dest_key: dest_key});
    phantomDone();
}

function shufStack(target) {
    if (target.hasClass("inHand")) {
        return;
    }
    if (!confirm("Are you sure you want to shuffle this?")) {
        return;
    }
    var dest_key = targetToGridKey(target);
    phantomUpdate(target, true);
    ws.send("stackop", {op_type: "shuffle",
                        dest_type: "board",
                        dest_key: dest_key});
    phantomDone();
}

function moveOffscreen(target) {
    if (parseInt(target.css("top")) != 2000) {
        target.animate({
            left: target.css("left"),
            top: 2000,
            opacity: 0,
        });
    }
}

function renderHandStack(hand){ 
    handCache = hand;
    var kHandSpacing = 5;
    var currentX = kHandSpacing;
    var handWidth = $("#hand").width();
    var cardWidth = $("#card_" + hand[0]).width();
    var cardHeight = $("#card_" + hand[0]).height();
    var handHeight = 220;
    var collapsedHandSpacing = Math.min(
        kHandSpacing + cardWidth,
        (handWidth - cardWidth - kHandSpacing * 2) / (hand.length - 1)
    );

    // Computes height of hand necessary.
    for (i in hand) {
        if (i == hand.length - 1) {
            break;
        }
        var cd = $("#card_" + hand[i]);
        if (!$("#hand").hasClass("collapsed")) {
            currentX += Math.max(cd.width(), 143) + kHandSpacing;
            if (currentX + cd.width() + 10 > handWidth) {
                handHeight += cd.height() + kHandSpacing;
                currentX = kHandSpacing;
            }
        }
    }

    handHeight = Math.min(handHeight, $("#arena").height() - cardHeight * 1.2);
    $("#hand").height(handHeight);

    var currentX = kHandSpacing;
    var currentY = $("#hand").position().top - $(window).scrollTop() + 15;
    var collapsed = $("#hand").hasClass("collapsed");

    /* TODO(ekl) https://github.com/benbarnett/jQuery-Animate-Enhanced/issues/97 */
    XXX_jitter *= -1;

    for (i in hand) {
        var cd = $("#card_" + hand[i]);
        if (!collapsed) {
            if (currentX + cd.width() + 10 > handWidth) {
                currentY += cd.height() + kHandSpacing;
                currentX = kHandSpacing;
            }
        }
        cd.addClass("inHand");
        cd.css("zIndex", 4000000 + parseInt(i));
        cd.data("stack_index", 4000000 + i);
        var xChanged = parseInt(currentX) != parseInt(cd.css('left'));
        var yChanged = parseInt(currentY) != parseInt(cd.css('top'));
        if (xChanged || yChanged) {
            cd.animate({
                left: currentX + (xChanged ? 0 : XXX_jitter),
                top: currentY + (yChanged ? 0 : XXX_jitter),
                opacity: 1.0,
            });
        }
        if ($("#hand").hasClass("collapsed")) {
            currentX += collapsedHandSpacing;
        } else {
            currentX += Math.max(cd.width(), 143) + kHandSpacing;
        }
    }
}

function redrawHand() {
    if (handCache) {
        renderHandStack(handCache);
    }
}

function showPhantomAtCard(target) {
    var offset = target.offset();
    var stack_index = target.data("stack_index");
    var k = kGridSpacing;
    if (target.hasClass("inHand")) {
        var x = offset.left;
        var y = offset.top;
    } else {
        var x = gridX(target);
        var y = gridY(target);
    }
    var phantom = $("#phantom");
    setOrientProperties(phantom, getOrient(target));
    phantom.width(target.width());
    phantom.height(target.height());
    var border_offset_x = 5;
    var border_offset_y = 5;
    if (phantom.hasClass("rotated")) {
        border_offset_x = 6;
        border_offset_y = 3;
    }
    phantom.css("left", x - border_offset_x + heightOf(stack_index));
    phantom.css("top", y - border_offset_y + heightOf(stack_index));
    phantom.css("z-index", target.css("zIndex") - 1);
    phantom.css("opacity", 0.4);
    phantom.show();
}

$(document).ready(function() {
    touchInit();
    var connected = false;

    function initCards() {
        $(".card").each(function(index, card) {
            setOrientProperties($(card), getOrient($(card)));
        });

        $(".card").draggable({
            containment: $("#arena"),
            refreshPositions: true,
        });

        $(".card").bind("dragstart", function(event, ui) {
            dragging = true;
            $("#menu").hide();
            $(".zoomed").fadeOut();
            var target = $(event.currentTarget);
            if (!target.hasClass("inHand")) {
                $("#hand").removeClass("active");
            }
            target.css("zIndex", 4500000);
            showPhantomAtCard(target);
            lastPhantomLocation = startPhantomLocation = targetToGridKey(target);
            phantomUpdate(target);
            ws.send("broadcast", {"subtype": "dragstart", "card": target.prop("id")});
        });

        $(".card").bind("drag", function(event, ui) {
            var target = $(event.currentTarget);
            dragging = true;
            target.stop();
            var dest_key = targetToGridKey(target);
            if (dest_key != lastPhantomLocation) {
                lastPhantomLocation = dest_key;
                phantomUpdate(target);
            }
        });

        $(".card").bind("dragstop", function(event, ui) {
            dragging = false;
            $("#phantom").fadeOut();
            phantomDone();
            e = event;
            var target = $(event.currentTarget);
            var card = parseInt(target.prop("id").substr(5));
            var orient = target.data("orient");
            if (target.hasClass("inHand")) {
                var dest_prev_type = "hands";
            } else {
                var dest_prev_type = "board";
            }
            if ($("#hand").hasClass("active")) {
                var dest_type = "hands";
                var dest_key = user;
            } else {
                var dest_type = "board";
                var dest_key = targetToGridKey(target);
                if (dest_prev_type == "hands") {
                    removeFromArray(handCache, card);
                    redrawHand();
                }
            }
            log("Sending card move.");
            ws.send("move", {move: {card: card,
                                    dest_prev_type: dest_prev_type,
                                    dest_type: dest_type,
                                    dest_key: dest_key,
                                    dest_orient: orient}});
        });

        $(".card").mousedown(function(event) {
            activeCard = $(event.currentTarget);
        });

        function showMenuForEvent(event) {
            var target = $(event.currentTarget);
            if (!dragging) {
                if (target.hasClass("inHand")
                        && $("#hand").hasClass("collapsed")) {
                    $("#hand").removeClass("collapsed");
                    redrawHand();
                } else {
                    var offset = target.offset();
                    if (target.hasClass("inHand")) {
                        zoomCard(target);
                        $(".boardonly").hide();
                    } else {
                        $(".boardonly").show();
                    }
                    $("#menu").hide();
                    $("#menu li").removeClass("hover");
                    var vExcess = Math.max(0,
                        offset.top + $("#menu").height() - window.innerHeight + 20
                    );
                    var hExcess = Math.max(0,
                        offset.left + $("#menu").width() - window.innerWidth + 20
                    );
                    $("#menu").css("top", offset.top - vExcess);
                    $("#menu").css("left", offset.left - hExcess);
                    $("#menu").show();
                    $("#menu").css("z-index", 450000000);
                    showPhantomAtCard(target);
                    menuReady = false;
                }
            }
            skipCollapse = true;
            dragging = false;
        }

        $(".card").contextmenu(function(event) {
            showMenuForEvent(event);
            return false;
        });

        $(".card").mouseup(function(event) {
            showMenuForEvent(event);
            return true;
        });
    }

    function reset(state) {
        log("Reset all local state.");
        $(".uuid_phantom").remove();
        $(".card").remove();
        $("#menu").hide();
        $("#phantom").hide();
        handCache = null;

        function createImageNode(state, cid, stack_index) {
            var url = state.urls[cid];
            var back_url = state.back_urls[cid] || state.default_back_url;
            if (state.orientations[cid] == undefined) {
                state.orientations[cid] = -1;
            }
            if (state.orientations[cid] < 0) {
                url = back_url;
            }
            var img = '<img style="z-index: ' + state.zIndex[cid] + '; display: none"'
                + ' id="card_' + cid + '"'
                + ' data-orient="' + state.orientations[cid] + '"'
                + ' data-front="' + state.urls[cid] + '"'
                + ' data-back="' + back_url + '"'
                + ' data-stack_index="' + stack_index + '"'
                + ' class="card" src="' + resourcePrefix + url + '">'
            $("#arena").append(img);
        }

        resourcePrefix = state.resource_prefix;
        for (pos in state.board) {
            var stack = state.board[pos];
            for (z in stack) {
                var cid = stack[z];
                var x = (pos & 0xffff) * kGridSpacing;
                var y = (pos >> 16) * kGridSpacing;
                createImageNode(state, cid, z);
                var card = $("#card_" + cid);
                card.animate({
                    left: x + heightOf(z),
                    top: y + heightOf(z),
                });
            }
        }
        for (player in state.hands) {
            var hand = state.hands[player];
            for (i in hand) {
                createImageNode(state, hand[i], i);
            }
            if (player == user) {
                renderHandStack(hand, false);
            } else {
                for (i in hand) {
                    moveOffscreen($("#card_" + hand[i]));
                }
            }
        }
        $(".card").fadeIn();
        initCards();
    }

    ws = $.websocket("ws:///" + hostname + ":" + kWSPort + "/kansas", {
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
            },
            error: function(e) {
                log("Error: " + e.msg);
            },
            reset: function(e) {
                reset(e.data[0]);
            },
            stackupdate: function(e) {
                log("Stack update: " + JSON.stringify(e.data));
                var x = (e.data.op.dest_key & 0xffff) * kGridSpacing;
                var y = (e.data.op.dest_key >> 16) * kGridSpacing;
                for (i in e.data.z_stack) {
                    var cd = $("#card_" + e.data.z_stack[i]);
                    cd.hide();
                }
                for (i in e.data.z_stack) {
                    var cd = $("#card_" + e.data.z_stack[i]);
                    cd.css("left", x + heightOf(i));
                    cd.css("top", y + heightOf(i));
                    cd.data("stack_index", i);
                    cd.css("z-index", e.data.z_index[i]);
                    setOrientProperties(cd, e.data.orient[i]);
                    cd.fadeIn();
                }
            },
            update: function(e) {
                log("Update: " + JSON.stringify(e.data));
                var target = $("#card_" + e.data.move.card);
                if (e.data.move.dest_type == "board") {
                    setOrientProperties(target, e.data.move.dest_orient);
                    var lastindex = e.data.z_stack.length - 1;
                    var x = (e.data.move.dest_key & 0xffff) * kGridSpacing;
                    var y = (e.data.move.dest_key >> 16) * kGridSpacing;
                    if (removeFromArray(handCache, e.data.move.card)) {
                        redrawHand();
                    }
                    for (i in e.data.z_stack) {
                        if (i == lastindex) {
                            continue; // Skips last element for later handling.
                        }
                        var cd = $("#card_" + e.data.z_stack[i]);
                        cd.css("left", x + heightOf(i));
                        cd.css("top", y + heightOf(i));
                        cd.data("stack_index", i);
                    }
                    target.data("stack_index", lastindex);
                    target.css("z-index", e.data.z_index);
                    var newX = x + heightOf(lastindex);
                    var newY = y + heightOf(lastindex);
                    var xChanged = parseInt(newX) != parseInt(target.css('left'));
                    var yChanged = parseInt(newY) != parseInt(target.css('top'));
                    XXX_jitter *= -1;
                    target.animate({
                        left: newX + (xChanged ? 0 : XXX_jitter),
                        top: newY + (yChanged ? 0 : XXX_jitter),
                        opacity: 1.0,
                    }, 'fast');
                    target.removeClass("inHand");
                } else if (e.data.move.dest_type == "hands") {
                    setOrientProperties(target, e.data.move.dest_orient);
                    if (e.data.move.dest_key == user) {
                        target.addClass("inHand");
                        renderHandStack(e.data.z_stack, true);
                    } else {
                        moveOffscreen(target);
                    }
                } else {
                    log("WARN: unknown dest type: " + e.data.move.dest_type);
                }
            },
            broadcast_message: function(e) {
                switch (e.data.subtype) {
                    case "dragstart":
                        $("#" + e.data.card).css("opacity", "0.7");
                        break;
                    case "phantomupdate":
                        var phantom = $("#" + e.data.uuid);
                        if (phantom.length == 0) {
                            var node = '<div class="uuid_phantom" id="' + e.data.uuid + '" style="position: fixed; border: 3px solid orange; pointer-events: none; border-radius: 5px; z-index: 999999; font-size: small;"><span style="background-color: orange; padding-right: 2px; padding-bottom: 2px; border-radius: 2px; color: white; margin-top: -2px !important; margin-left: -1px;">' + e.data.name + '</span></div>';
                            $("#arena").append(node);
                            phantom = $("#" + e.data.uuid);
                        }
                        if (e.data.hide) {
                            phantom.fadeOut(2000);
                        } else {
                            phantom.stop();
                            phantom.css('opacity', 1.0);
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

    $("#connect").mouseup(function(e) {
        requireConnect();
    });

    $("#sync").mouseup(function(e) {
        ws.send("resync");
    });

    $("#reset").mouseup(function(e) {
        if (confirm("Are you sure you want to reset the game?")) {
            ws.send("reset");
        }
    });

    $("#debug").mouseup(function(e) {
        $("#console").toggle();
        loggingEnabled = !loggingEnabled;
    });

    $("#hand").droppable({
        over: function(event, ui) {
            if (dragging) {
                var card = parseInt(activeCard.prop("id").substr(5));
                removeFromArray(handCache, card);
            }
            $("#hand").addClass("active");
            if (dragging && !activeCard.hasClass("inHand")) {
                redrawHand();
            }
        },
        out: function(event, ui) {
            if (dragging) {
                var card = parseInt(activeCard.prop("id").substr(5));
                removeFromArray(handCache, card);
            }
            $("#hand").removeClass("active");
            if (dragging && !$("#hand").hasClass("collapsed")) {
                $("#hand").addClass("collapsed");
                redrawHand();
            }
        },
        tolerance: "touch",
    });

    $("#menu").disableSelection();
    $("#arena").disableSelection();
    $("body").disableSelection();
    $("html").disableSelection();
    $("#hand").disableSelection();

    $("#arena").mouseup(function(event) {
        if (skipCollapse) {
            log("arena mouseup: skipping collapse");
            skipCollapse = false;
        } else {
            log("arena mouseup: collapse hand");
            $(".zoomed").fadeOut();
            $("#hand").addClass("collapsed");
            redrawHand();
        }
    });

    $("#menu li").mousedown(function(event) {
        menuReady = true;
        event.stopPropagation();
        $(event.currentTarget).addClass("hover");
    });

    $("#menu li").mouseup(function(event) {
        if (!menuReady) {
            return;
        }
        var eventTable = {
            'zoom': zoomCard,
            'flip': flipCard,
            'rotate': rotateCard,
            'flipstack': flipStack,
            'shufstack': shufStack,
        };
        eventTable[$(event.currentTarget).attr("id")](activeCard);
        $("#menu").hide();
        $("#menu li").removeClass("hover");
        $("#phantom").hide();
        skipCollapse = true;
    });

    $("#menu").mousedown(function(event) {
        menuReady = true;
    });

    $("#arena").mousedown(function(event) {
        $("#menu").hide();
        $("#phantom").hide();
    });

    $("#hand").mousedown(function(event) {
        $("#menu").hide();
        $("#phantom").hide();
    });

    $("#hand").mouseup(function(event) {
        log("hand click: show hand");
        if ($("#hand").hasClass("collapsed")) {
            $("#hand").removeClass("collapsed");
            redrawHand();
        }
    });

    $(window).resize(function() { redrawHand(); });
    setTimeout(requireConnect, 1000);
});

// vim: et sw=4
