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

// Default settings for websocket connection.
var kWSPort = 8080
var gameid = "testgame1";
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);
var user = window.location.hash || "#alice";
var ws = null;
var loggingEnabled = false;
var gameReady = false;
document.title = user + '@' + gameid;

// Tracks local state of the hand and zIndex of the topmost card.
var handCache = [];
var localMaxZ = 200;

// Minimum zIndexes for various states.
var kHandZIndex = 4000000;
var kDraggingZIndex = 4500000;

// The URL prefix from which card images are downloaded from.
var resourcePrefix = '';

// Tracks the dragging card, hover menu, snappoint, etc.
var activeCard = null;
var draggingId = null;
var dragStartKey = null;
var hasDraggedOffStart = false;
var hoverCardId = null;
var oldSnapCard = null;
var containmentHint = null;
var selectedSet = [];

// Tracks the frame (dragging position) of the local user, which is broadcasted 
// to other users to show them where this user is doing actions.
var lastFrameLocation = 0;
var lastFrameUpdate = 0;
var frameHideQueued = {};

// Limits frame updates to 5fps.
var kFrameUpdatePeriod = 200;

// Tracks mouseup/down state for correct event handling.
var disableArenaEvents = false;
var dragging = false;

// Workaround for https://github.com/benbarnett/jQuery-Animate-Enhanced/issues/97
var XXX_jitter = 1;

// Set to kAnimationLength once initial load has completed.
var animationLength = 0;
var kAnimationLength = 500;

// Max index of discrete positions on one axis of the grid. Must be < 0xffff.
var kMaxGridIndex = 0x7ff;

// Geometry of cards.
var kCardWidth = 140;
var kCardHeight = 200;
var kCardBorder = 4;
var kRotatedOffsetLeft = -10;
var kRotatedOffsetTop = 25;
var kMinHandHeight = 100;
var kHoverCardRatio = 4;
var kHoverTapRatio = kHoverCardRatio * 0.875;
var kSelectionBoxPadding = 15;
var kMinSupportedHeight = 1000;

// XXX testing geometry
if (user == "#alice") {
    var clientRotation = 0;
    var clientTranslation = [0, 0];
} else {
    var clientRotation = 2;
    var clientTranslation = [-kCardWidth, -kCardHeight];
}

// Keeps mapping from key -> height
var stackDepthCache = {};

/**
 * When cards are stacked on each other we want to provide a 3d-illusion.
 * heightOf() returns the proper x, y offset for cards in the stack.
 */
function heightOf(stackHeight) {
    if (stackHeight === undefined
            || isNaN(stackHeight)
            || stackHeight >= kHandZIndex) {
        return 0;
    }
    var kStackDelta = 2;
    var kMaxVisibleStackHeight = 9;
    if (stackHeight > kMaxVisibleStackHeight) {
        stackHeight = kMaxVisibleStackHeight;
    }
    return stackHeight * kStackDelta;
}

/* Returns all cards in the same stack as memberCard. */
function stackOf(memberCard) {
    var key = memberCard.data("dest_key");
    return $(".card").filter(function(index) {
        return $(this).data("dest_key") == key;
    });
}

/* Returns topmost card in stack. */
function topOf(stack) {
    var maxZ = 0;
    var highest = null;
    stack.each(function(i) {
        var z = $(this).zIndex();
        if (parseInt(z) > maxZ) {
            maxZ = z;
            highest = $(this);
        }
    });
    return highest;
}

/* Returns [topmost, lowermost, toprot, lowrot, topunrot, lowunrot] */
function extremes(stack) {
    var result = [null, null, null, null, null, null];
    var prevZ = [0, Infinity, 0, Infinity, 0, Infinity];
    stack.each(function(i) {
        var t = $(this);
        var z = $(this).zIndex();
        if (t.hasClass("rotated")) {
            if (z > prevZ[2]) {
                prevZ[2] = z;
                result[2] = t;
            }
            if (z < prevZ[3]) {
                prevZ[3] = z;
                result[3] = t;
            }
        } else {
            if (z > prevZ[4]) {
                prevZ[4] = z;
                result[4] = t;
            }
            if (z < prevZ[5]) {
                prevZ[5] = z;
                result[5] = t;
            }
        }
        if (z > prevZ[0]) {
            prevZ[0] = z;
            result[0] = t;
        }
        if (z < prevZ[1]) {
            prevZ[1] = z;
            result[1] = t;
        }
    });
    return result;
}

/* Invoked on receipt of a drag_start broadcast. */
function handleDragStartBroadcast(e) {
    var card = $("#" + e.data.card);
    $.each(card.attr("class").split(" "), function(i, cls) {
        if (cls.substring(0,9) == "faded_by_") {
            card.removeClass(cls);
        }
    });
    card.addClass("faded_by_" + e.data.uuid);
    card.css("opacity", 0.6);
}

/* Invoked on receipt of a frame_update broadcast. */
function handleFrameUpdateBroadcast(e) {
    var frame = $("#" + e.data.uuid);
    if (frame.length == 0 && !e.data.hide ) {
        var node = '<div class="uuid_frame" id="'
            + e.data.uuid + '"><span>'
            + e.data.name + '</span></div>';
        $("#arena").append(node);
        frame = $("#" + e.data.uuid);
    } else {
        frame.children("span").text(e.data.name);
    }
    if (e.data.hide) {
        frameHideQueued[e.data.uuid] = true;
        setTimeout(function() {
            if (frameHideQueued[e.data.uuid]) {
                frame.hide();
                $(".faded_by_" + e.data.uuid).css("opacity", 1);
                frameHideQueued[e.data.uuid] = false;
            }
        }, 1500);
    } else {
        frameHideQueued[e.data.uuid] = false;
        var flipName = clientRotation != e.data.native_rotation;
        var init = e.data.sizing_info.pop();
        var initKey = toClientKey(init[1]);
        var minX = keyToX(initKey) + init[2] + (init[0] ? kRotatedOffsetLeft : 0);
        var minY = keyToY(initKey) + init[2] + (init[0] ? kRotatedOffsetTop : 0);
        function getW(info) {
            return (info[0] ? kCardHeight : kCardWidth);
        }
        function getH(info) {
            return (info[0] ? kCardWidth : kCardHeight);
        }
        var maxX = minX + 2 * kCardBorder + getW(init);
        var maxY = minY + 2 * kCardBorder + getH(init);
        $.each(e.data.sizing_info, function(i, val) {
            var key = toClientKey(val[1]);
            var x = keyToX(key) + val[2];
            var y = keyToY(key) + val[2];
            var dx = val[0] ? kRotatedOffsetLeft : 0;
            var dy = val[0] ? kRotatedOffsetTop : 0;
            minX = Math.min(minX, x + dx);
            minY = Math.min(minY, y + dy);
            var w = 2 * kCardBorder + getW(val);
            var h = 2 * kCardBorder + getH(val);
            maxX = Math.max(maxX, x + dx + w);
            maxY = Math.max(maxY, y + dy + h);
        });
        frame.width(maxX - minX - 6 + 2 * e.data.border);
        frame.height(maxY - minY - 6 + 2 * e.data.border);
        frame.css("left", minX - e.data.border);
        frame.css("top", minY - e.data.border);
        if (flipName) {
            frame.addClass("flipName");
        } else {
            frame.removeClass("flipName");
        }
        frame.show();
    }
}

function handleSelectionMoved(selectedSet, dx, dy) {
    showSpinner();
    selectedSet.each(function(i) {
        var card = $(this);
        var cardId = parseInt(card.prop("id").substr(5));
        var dest = card.data("dest_key");
        var key = keyFromCoords(keyToX(dest) + dx, keyToY(dest) + dy);
        ws.send("move", {move: {card: cardId,
                                dest_prev_type: "board",
                                dest_type: "board",
                                dest_key: toCanonicalKey(key),
                                dest_orient: getOrient(card)}});
    });
}

function handleSelectionClicked(selectedSet) {
    // TODO render hovermenu with the following features:
    // browse and bring to front a card
    // collapse selection into a single stack
    // tap / untap all
    warning("NOTIMPLEMENTED");
}

function handleSelectionMovedFromHand(selectedSet, x, y) {
    showSpinner();
    var snap = findSnapPoint($("#selectionbox"));
    if (snap != null) {
        var fixedKey = parseInt(snap.data("dest_key"));
    }
    selectedSet.each(function(i) {
        var card = $(this);
        var cardId = parseInt(card.prop("id").substr(5));
        var key = (snap != null) ? fixedKey : keyFromCoords(x, y);
        ws.send("move", {move: {card: cardId,
                                dest_prev_type: "hands",
                                dest_type: "board",
                                dest_key: toCanonicalKey(key),
                                dest_orient: getOrient(card)}});
    });
}

function handleSelectionMovedToHand(selectedSet) {
    showSpinner();
    selectedSet.each(function(i) {
        var card = $(this);
        var cardId = parseInt(card.prop("id").substr(5));
        ws.send("move", {move: {card: cardId,
                                dest_prev_type: "board",
                                dest_type: "hands",
                                dest_key: user,
                                dest_orient: getOrient(card)}});
    });
}

/* Returns absolute url of a resource. */
function toResource(url) {
    if (url && url.toString().substring(0,5) == "http:") {
        return url;
    } else {
        return resourcePrefix + url;
    }
}

/* Highlights hand to receive drops. */
function activateHand() {
    deactivateQueued = false;
    $("#hand").addClass("active");
    if (oldSnapCard != null) {
        oldSnapCard.removeClass("snappoint");
        oldSnapCard = null;
    }
}

/* Removes highlight from hand. */
function deactivateHand() {
    deactivateQueued = false;
    $("#hand").removeClass("active");
}

/* Removes highlight from hand after a while. */
var deactivateQueued = false;
function deferDeactivateHand() {
    deactivateQueued = true;
    setTimeout(_reallyDeactivateHand, 1000);
}

function _reallyDeactivateHand() {
    if (deactivateQueued) {
        $("#hand").removeClass("active");
        deactivateQueued = false;
    }
}

/* Shows the "Loading..." spinner. */
var spinnerShowQueued = false;
function showSpinner() {
    if (!spinnerShowQueued) {
        spinnerShowQueued = true;
        setTimeout(_reallyShowSpinner, 500);
    }
}

function _reallyShowSpinner() {
    if (spinnerShowQueued) {
        $("#spinner").show();
        spinnerShowQueued = false;
    }
}

/* Hides the "Loading..." spinner. */
function hideSpinner() {
    spinnerShowQueued = false;
    $("#spinner").hide();
}

/**
 * Utility that removes an element from an array.
 * Returns if the element was present in the array.
 */
function removeFromArray(arr, item) {
    var idx = $.inArray(item, arr);
    if (idx >= 0) {
        arr.splice(idx, 1);
        return true;
    } else {
        return false;
    }
}

/* Logs a message to the debug console */
function log(msg, force) {
    if (loggingEnabled || force) {
        var console = $('#console');
        console.append(msg + "\n");
        console.scrollTop(console[0].scrollHeight - console.outerHeight());
    }
}

/* Logs warning to debug console */
function warning(msg) {
    log(msg, true);
    alert("W: " + msg);
}

/**
 * Hack to map touch into mouse events, from
 * http://stackoverflow.com/questions/5186441/javascript-drag-and-drop-for-touch-devices
 */
function touchHandler(event) {
    var touches = event.changedTouches,
    first = touches[0],
    type = "";

    switch (event.type) {
        case "touchstart": type="mousedown"; break;
        case "touchmove": type="mousemove"; break;
        case "touchend": type="mouseup"; break;
        case "touchleave": type="mouseleave"; break;
        default: return;
    }

    var simulatedEvent = document.createEvent("MouseEvent");
    simulatedEvent.initMouseEvent(type, true, true, window, 1,
                                  first.screenX, first.screenY,
                                  first.clientX, first.clientY, false,
                                  false, false, false, 0, null);

    first.target.dispatchEvent(simulatedEvent);
    event.preventDefault();
}

/**
 * Returns the card orientation (one of [-4,-3,-2,-1,1,2,3,4]).
 * Here, card is the jquery selection corresponding to the card,
 * e.g. $("#card_24")
 */
function getOrient(card) {
    var orient = card.data("orient");
    if (orient == 0) {
        orient = 1;
    }
    return orient;
}

/* Changes the visible orientation the card */
function setOrientProperties(card, orient) {
    card.data("orient", orient);
    if (orient > 0) {
        card.prop("src", toResource(card.data("front")));
    } else {
        card.prop("src", toResource(card.data("back")));
    }

    if (Math.abs(orient) == 2) {
        card.addClass("rotated");
    } else {
        card.removeClass("rotated");
    }
}

function keyFromCoords(x, y) {
    var xRatio = Math.min(1, Math.max(0, x / $("#arena").outerWidth()));
    var yRatio = Math.min(1, Math.max(0,
        y / ($("#arena").outerHeight() - kMinHandHeight)));
    return Math.ceil(xRatio * kMaxGridIndex)
        | Math.ceil(yRatio * kMaxGridIndex) << 16;
}

/* Returns the x-key of the card in the client view. */
function xKeyComponent(target) {
    var offset = target.offset();
    var left = offset.left;
    if (target.prop("id") != draggingId) {
      left -= heightOf(target.data("stack_index"));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        left -= parseInt(target.css("margin-left"));
    }
    // Normalize to grid width.
    var ratio = Math.min(1, Math.max(0, left / $("#arena").outerWidth()));
    return Math.ceil(ratio * kMaxGridIndex);
}

/* Returns the y-key of the card in the client view. */
function yKeyComponent(target) {
    var offset = target.offset();
    var tp = offset.top;
    if (target.prop("id") != draggingId) {
        tp -= heightOf(target.data("stack_index"));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        tp -= parseInt(target.css("margin-top"));
    }
    // Normalize to grid height.
    var ratio = Math.min(1, Math.max(0,
        tp / ($("#arena").outerHeight() - kMinHandHeight)));
    return Math.ceil(ratio * kMaxGridIndex);
}

/**
 * Packs the x-key and y-key into a single 32-bit tuple.
 * that the websocket server uses to specify a position.
 */
function packKey(x, y) {
    return x | (y << 16);
}

/* Extracts x-coord from key. */
function keyToX(key) {
    return ((key & 0xffff) / kMaxGridIndex) * $("#arena").outerWidth();
}

/* Extracts y-coord from key. */
function keyToY(key) {
    return ((key >> 16) / kMaxGridIndex) * ($("#arena").outerHeight() - kMinHandHeight);
}

/* Translates x from server view to geometry on screen. */
function toClientX(x) {
    return toCanonicalX(x, true);
}

/* Translates y from server view to geometry on screen. */
function toClientY(y) {
    return toCanonicalY(y, true);
}

/* Translates locations from server view to geometry on screen. */
function toClientKey(canonicalKey) {
    if (isNaN(canonicalKey)) {
        return canonicalKey;
    }
    var x = keyToX(canonicalKey);
    var y = keyToY(canonicalKey);
    return keyFromCoords(toClientX(x), toClientY(y));
}

/* Translates x from geometry on screen to server view. */
function toCanonicalX(x, invert) {
    if (invert) {
        x -= clientTranslation[0];
    }
    switch (clientRotation) {
        case 0:
            /* no-op */
            break;
        case 2:
            /* mirror X */
            x = $("#arena").outerWidth() - x;
            break;
        default:
            warning("Unsupported client rotation: " + clientRotation);
            break;
    }
    if (!invert) {
        x += clientTranslation[0];
    }
    return x;
}

/* Translates y from geometry on screen to server view. */
function toCanonicalY(y, invert) {
    if (invert) {
        y -= clientTranslation[1];
    }
    switch (clientRotation) {
        case 0:
            /* no-op */
            break;
        case 2:
            /* mirror Y */
            y = $("#arena").outerHeight() - kMinHandHeight - y;
            break;
        default:
            warning("Unsupported client rotation: " + clientRotation);
            break;
    }
    if (!invert) {
        y += clientTranslation[1];
    }
    return y;
}

/* Translates locations from geometry on screen to server view. */
function toCanonicalKey(clientKey) {
    if (isNaN(clientKey)) {
        return clientKey;
    }
    var x = keyToX(clientKey);
    var y = keyToY(clientKey);
    return keyFromCoords(toCanonicalX(x), toCanonicalY(y));
}

/* Produces a location key from a jquery selection. */
function keyFromTargetLocation(target) {
    return xKeyComponent(target) | (yKeyComponent(target) << 16);
}

/* Highlights new snap-to card, and unhighlights old one. */
function setSnapPoint(snap) {
    var hand = $("#hand").hasClass("active");
    if (snap != null) {
        if (hand) {
            snap.removeClass("snappoint");
        } else {
            snap.addClass("snappoint");
        }
    }
    if (oldSnapCard != null) {
        if (snap == null) {
            oldSnapCard.removeClass("snappoint");
        } else if (oldSnapCard.prop("id") != snap.prop("id")) {
            oldSnapCard.removeClass("snappoint");
        }
    }
    oldSnapCard = snap;
}

/* Returns card at top of stack to snap to or NULL. */
function findSnapPoint(target) {
    // Enforces that selections with more than 1 stack do not snap.
    if (target.prop("id") == "selectionbox") {
        var seen = {};
        var numStacks = 0;
        $(".selecting").each(function(i) {
            var key = $(this).data("dest_key");
            if (!seen[key]) {
                seen[key] = true;
                numStacks += 1;
            }
        });
        if (numStacks > 1) {
            return null;
        }
    }
    var kSnapThresholdPixels = 100;
    var kAxisThresholdPixels = 20;
    var targetId = target.prop("id");
    var x = target.offset().left;
    var y = target.offset().top;
    var w = target.width();
    var h = target.height();
    var minDist = 9999999;
    var closest = null;
    $(".card").each(function(i) {
        var node = $(this);
        if (!node.hasClass("inHand") && node.prop("id") != targetId) {
            var cx = node.offset().left;
            var cy = node.offset().top;
            var dx = Math.abs(cx - x);
            var dy = Math.abs(cy - y);
            var dist = Math.sqrt(
                Math.pow(dx, 2)
                + Math.pow(dy, 2));
            if (((dist < kSnapThresholdPixels
                    && (dx < kAxisThresholdPixels || dy < kAxisThresholdPixels))
                    || ( // Checks if node is completely contained.
                        cx + kCardWidth < x + w &&
                        cy + kCardHeight < y + h &&
                        x < cx && y < cy
                    ))
                    && dist < minDist) {
                minDist = dist;
                closest = node;
            }
        }
    });
    if (closest == null) {
        return null;
    } else {
        var snap = topOf(stackOf(closest).not(target));
        return snap;
    }
}

/* Flips cards that are on the other side of the board. */
function updateCardFlipState(card, newY) {
    var y = (newY !== undefined) ? newY : card.offset().top
    if (y + card.height() < $("#divider").offset().top) {
        card.addClass("flipped");
    } else {
        card.removeClass("flipped");
    }
}

/**
 * Broadcasts location and highlights snap-to areas in a timely manner.
 */
function updateDragProgress(target, force) {
    if ($.now() - lastFrameUpdate > kFrameUpdatePeriod || force) {
        lastFrameUpdate = $.now();
        var dest_key = keyFromTargetLocation(target);
        if (dest_key != lastFrameLocation) {
            hasDraggedOffStart = true;
            lastFrameLocation = dest_key;
            updateFocus(target);
        }
    }
}

/* Call this before updateDragProgress() */
function startDragProgress(target) {
    lastFrameLocation = keyFromTargetLocation(target);
    if (target.hasClass("card")) {
        ws.send("broadcast",
            {"subtype": "dragstart", "uuid": uuid, "card": target.prop("id")});
    } else if (target.prop("id") == "selectionbox") {
        selectedSet.each(function(i) {
            ws.send("broadcast",
                {"subtype": "dragstart", "uuid": uuid, "card": $(this).prop("id")});
        });
    }
    updateFocus(target);
}

/**
 * Broadcasts the location of target to other users, so that their clients
 * can draw a frame box where the card is being dragged.
 */
function updateFocus(target, noSnap) {
    if (target.length == 0) {
        log("Whoops, no focus.");
        removeFocus();
        return;
    }

    var isCard = target.hasClass("card");
    if (isCard) {
        hideSelectionBox();
    }

    if (isCard && !target.hasClass("highlight")) {
        $(".card").removeClass("highlight");
        target.addClass("highlight");
    }

    var snap = noSnap ? null : findSnapPoint(target);
    setSnapPoint(snap);

    if (target.hasClass("inHand")) {
        log("Target in hand - removing focus to keep movement private.");
        ws.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": true,
                "uuid": uuid,
            });
        return;
    }

    // By default renders the fixed selection.
    var sizingInfo = containmentHint;
    if (isCard) {
        if (snap == null) {
            if (hasDraggedOffStart) {
                log("Rendering free-dragging card.");
                sizingInfo = [[
                    target.hasClass("rotated"),
                    toCanonicalKey(keyFromTargetLocation(target)), 0]];
            } else {
                log("Rendering just-selected card on stack.");
                sizingInfo = [[
                    target.hasClass("rotated"),
                    toCanonicalKey(target.data("dest_key")),
                    heightOf(stackDepthCache[target.data("dest_key")] - 1)]];
            }
        } else {
            log("Rendering card snapping to stack");
            sizingInfo = [[
                snap.hasClass("rotated"),
                toCanonicalKey(snap.data("dest_key")),
                heightOf(stackDepthCache[snap.data("dest_key")])]];
        }
    } else if (snap != null) {
        log("Rendering selection snapped to stack");
        sizingInfo = [[
            snap.hasClass("rotated"),
            toCanonicalKey(snap.data("dest_key")),
            heightOf(stackDepthCache[snap.data("dest_key")])]];
    } else if (sizingInfo != null) {
        log("Rendering free-dragging selection");
        var delta = selectionBoxOffset();
        var dx = delta[2];
        var dy = delta[3];
        sizingInfo = $.map(sizingInfo, function(info) {
            var orig = toClientKey(info[1]);
            var current = keyFromCoords(keyToX(orig) + dx, keyToY(orig) + dy);
            return [[info[0], toCanonicalKey(current), info[2]]];
        });
    } else {
        log("Not rendering selection in hand.");
        return;
    }

    ws.send("broadcast",
        {
            "subtype": "frameupdate",
            "hide": false,
            "uuid": uuid,
            "name": user,
            "border": isCard ? 0 : kSelectionBoxPadding,
            "sizing_info": sizingInfo,
            "native_rotation": clientRotation,
        });
}

/* Hides bounding box and associated selection objects. */
function hideSelectionBox() {
    if ($("#selectionbox").is(":visible")) {
        $("#selectionbox").hide();
        $("#selectionarea").hide();
        $("#selectionbox").css("margin-left", 0);
        $("#selectionbox").css("margin-top", 0);
        $(".selecting").removeClass("selecting");
    }
}

/* Returns [x, y, dx, dy] of selection box relative to selection area. */
function selectionBoxOffset() {
    var box = $("#selectionbox");
    var outer = $("#arena");
    var offset = box.offset();
    var orig_offset = $("#selectionarea").offset();
    var x = Math.max(0, offset.left);
    var y = Math.max(0, offset.top);
    x = Math.min(x, outer.width() - box.width());
    y = Math.min(y, outer.height() - box.height());
    var dx = x - orig_offset.left;
    var dy = y - orig_offset.top;
    return [x, y, dx, dy];
}

/* Unselects all selected items, and hides hover menu. */
function removeFocus(doAnimation) {
    log("unfocus")
    removeHoverMenu(doAnimation);
    setSnapPoint(null);
    hideSelectionBox();
    $(".card").removeClass("highlight");
    $(".card").css("box-shadow", "none");
    if (gameReady) {
        ws.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": true,
                "uuid": uuid,
            });
    }
}

/* Sets and broadcasts the visible orientation of the card. */
function changeOrient(card, orient) {
    setOrientProperties(card, orient);
    updateFocus(card);

    var cardId = parseInt(card.prop("id").substr(5));
    var dest_type = "board";
    var dest_prev_type = "board";
    var dest_key = parseInt(card.data("dest_key"));
    if (card.hasClass("inHand")) {
        dest_type = "hands";
        dest_key = user;
        dest_prev_type = "hands";
    }
    log("Sending orient change.");
    showSpinner();
    ws.send("move", {move: {card: cardId,
                            dest_type: dest_type,
                            dest_key: toCanonicalKey(dest_key),
                            dest_prev_type: dest_type,
                            dest_orient: orient}});
}

/* Rotates card to 90deg. */
function rotateCard(card) {
    var orient = getOrient(card);
    changeOrient(card, Math.abs(orient) / orient * 2);
    $(".hovermenu")
        .children("img")
        .height(kCardHeight * kHoverTapRatio)
        .width(kCardWidth * kHoverTapRatio)
        .addClass("hoverRotate");
}

/* Rotates card to 0deg. */
function unrotateCard(card) {
    var orient = getOrient(card);
    changeOrient(card, Math.abs(orient) / orient);
    $(".hovermenu")
        .children("img")
        .removeClass("hoverRotate")
        .height(kCardHeight * kHoverCardRatio)
        .width(kCardWidth * kHoverCardRatio);
}

/* Toggles and broadcasts card face up/down. */
function flipCard(card) {
    changeOrient(card, -getOrient(card));
    var url = getOrient(card) > 0 ? card.data("front_full") : card.data("back");
    $(".hovermenu").children("img").prop("src", url);
}

/* Moves card to top of stack. */
function raiseCard(card) {
    changeOrient(card, getOrient(card));
}

/* No-op that shows card privately in hovermenu. */
function peekCard(card) {
    var url = activeCard.data("front_full");
    var src = toResource(url);
    $(".hovermenu img").prop("src", activeCard.data("front_full"));
    return "disablethis";
}

/* Requests a stack flip from the server. */
function flipStack(memberCard) {
    var dest_key = parseInt(memberCard.data("dest_key"));
    createSelection(stackOf(memberCard));
    showSpinner();
    ws.send("stackop", {op_type: "reverse",
                        dest_type: "board",
                        dest_key: toCanonicalKey(dest_key)});
}

function shuffleStackConfirm() {
    var node = $(".shufstackconfirm");
    node.removeClass("shufstackconfirm");
    node.removeClass("hover");
    node.addClass("confirm");
    node.data("key", "shufstack");
    node.html("You&nbsp;sure?");
    return "keepmenu";
}

/* Requests a stack shuffle from the server. */
function shuffleStack(memberCard) {
    if (memberCard.hasClass("inHand")) {
        return;
    }
    var dest_key = parseInt(memberCard.data("dest_key"));
    createSelection(stackOf(memberCard));
    showSpinner();
    ws.send("stackop", {op_type: "shuffle",
                        dest_type: "board",
                        dest_key: toCanonicalKey(dest_key)});
    removeFocus();
}

/* Shows hovermenu of prev card in stack. */
function stackNext(memberCard) {
    var idx = parseInt(memberCard.data("stack_index")) - 1;
    var next = stackOf(memberCard).filter(function() {
        return $(this).data("stack_index") == idx;
    });
    activeCard = next;
    showHoverMenu(next);
    return "keepmenu";
}

/* Shows hovermenu of prev card in stack. */
function stackPrev(memberCard) {
    var idx = parseInt(memberCard.data("stack_index")) + 1;
    var prev = stackOf(memberCard).filter(function() {
        return $(this).data("stack_index") == idx;
    });
    activeCard = prev;
    showHoverMenu(prev);
    return "keepmenu";
}

/* Garbage collects older hovermenu image. */
function removeHoverMenu(doAnimation) {
    var old = $(".hovermenu");
    hoverCardId = null;
    if (old.length > 0) {
        if (doAnimation) {
            old.fadeOut();
        } else {
            old.hide();
        }
        setTimeout(function() { old.remove(); }, 1000);
    }
}

/**
 * Displays a large version of the card image at the center of the screen,
 * along with controls for the stack.
 */
function showHoverMenu(card) {
    hoverCardId = card.prop("id");
    log("Hover menu for #" + hoverCardId + "@" + card.data("dest_key"));
    var old = $(".hovermenu");
    var oldimg = $(".hovermenu img");
    var numCards = stackHeightCache[card.data("dest_key")];
    var i = numCards - parseInt(card.data("stack_index"));
    var url = getOrient(card) > 0 ? card.data("front_full") : card.data("back");
    var src = toResource(url);
    var flipStr = getOrient(card) > 0 ? "Cover" : "Reveal";
    var imgCls = '';
    if (card.hasClass("rotated")) {
        var tapFn =  '<li style="margin-left: -190px" class="boardonly"'
            + ' data-key="unrotate">Untap</li>'
        var height = kCardHeight * kHoverTapRatio;
        var width = kCardWidth * kHoverTapRatio;
        imgCls = "hoverRotate";
    } else {
        var tapFn =  '<li style="margin-left: -190px" class="boardonly"'
            + ' data-key="rotate">Tap</li>'
        var height = kCardHeight * kHoverCardRatio;
        var width = kCardWidth * kHoverCardRatio;
    }

    var cardContextMenu = (''
        + '<li class="top" style="margin-left: -190px"'
        + ' data-key=flip>' + flipStr + '</li>'
        + tapFn
        + '<li style="margin-left: -190px"'
        + ' class="bottom nobulk peek boardonly" data-key="peek">Peek'
        + '</li>');

    var html = ('<div class="hovermenu">'
        + '<img class="' + imgCls + '" style="height: '
        + height + 'px; width: ' + width + 'px;"'
        + ' src="' + src + '"></img>'
        + '<ul class="hovermenu" style="float: right; width: 50px;">'
        + '<span class="header" style="margin-left: -190px">&nbsp;CARD</span>"'
        + cardContextMenu
        + '<span class="header" style="margin-left: -190px">&nbsp;STACK</span>"'
        + '<li style="margin-left: -190px" class="stackprev top boardonly bulk"'
// TODO figure out what goes here, and what in hovermenu for selection
//        + ' data-key="stackprev">Prev</li>'
//        + '<li style="margin-left: -190px"'
//        + ' class="stacknext boardonly bulk"'
//        + ' data-key="stacknext">Next</li>'
        + '<li style="margin-left: -190px" class="top boardonly bulk"'
        + ' data-key="flipstack">Invert</li>'
        + '<li style="margin-left: -190px"'
        + ' class="bottom boardonly bulk shufstackconfirm"'
        + ' data-key="shufstackconfirm">Shuffle</li>'
        + '</ul>'
        + '<div class="hovernote"><span>Card ' + i + ' of ' + numCards + '</span></div>'
        + '</div>');

    var newNode = $(html).appendTo("body");
    if (card.hasClass("inHand")) {
        $(".boardonly").addClass("disabled");
        $(".hovernote").hide();
    } else if (numCards > 1) {
        $(".hovernote").show();
        $(".boardonly").removeClass("disabled");
        $(".nobulk").addClass("disabled");
    } else {
        $(".hovernote").hide();
        $(".boardonly").removeClass("disabled");
        $(".bulk").addClass("disabled");
    }
    if (getOrient(card) > 0 || card.hasClass("flipped")) {
        $(".peek").addClass("disabled");
    }
    var newImg = newNode.children("img");
    newNode.width(805);
    newNode.height(kCardHeight * kHoverCardRatio);
    newNode.css("margin-left", - ($(".hovermenu").outerWidth() / 2));
    newNode.css("margin-top", - ($(".hovermenu").outerHeight() / 2));
    if (old.filter(':visible').length > 0) {
        if (oldimg.prop("src") == newImg.prop("src")) {
            oldimg.fadeOut();
        }
        newNode.fadeIn();
    } else {
        newNode.show();
    }
    if (newNode.offset().top < 0) {
        newNode.css("margin-top", 0);
        newNode.css("top", 0);
    }
    setTimeout(function() { old.remove(); }, 1200);
}

/* Moves a card offscreen - used for hiding hands of other players. */
function moveOffscreen(card) {
    var kOffscreenY = -300;
    var destX = 100;
    if (parseInt(card.css("top")) != kOffscreenY) {
        card.animate({
            left: (destX != parseInt(card.css("left"))) ? destX : destX + XXX_jitter,
            top: kOffscreenY,
            opacity: 1.0,
        }, animationLength);
    }
}

/* Redraws user's hand given an array of cards present. */
function renderHandStack(hand) {
    handCache = hand;

    var kHandSpacing = 5;
    var kConsiderUnloaded = 20;
    var currentX = kHandSpacing;
    var handWidth = $("#hand").outerWidth();
    var cardWidth = kCardWidth + 8;
    var cardHeight = kCardHeight + 8;
    var collapsedHandSpacing = Math.min(
        kHandSpacing + cardWidth,
        (handWidth - cardWidth - kHandSpacing * 2) / (hand.length - 1)
    );

    // Computes dimensions of hand necessary and optimal spacing.
    var requiredWidth = hand.length * (cardWidth + kHandSpacing);
    var numRows = Math.max(1, Math.ceil(requiredWidth / (handWidth - kHandSpacing)));
    var numCols = Math.floor((handWidth - kHandSpacing) / (cardWidth + kHandSpacing));
    var excess = handWidth - (numCols * (cardWidth + kHandSpacing)) - kHandSpacing;
    var spacing = kHandSpacing;

    var handHeight = numRows * (cardHeight + kHandSpacing) + kHandSpacing;
    handHeight = Math.min(handHeight, $("#arena").outerHeight() - cardHeight * 2);
    $("#hand").height(handHeight);
    var collapsed = $("#hand").hasClass("collapsed");
    if (!collapsed) {
        var startX = spacing;
    } else {
        var startX = 0;
    }
    var currentX = startX;
    var currentY = $("#hand").position().top - $(window).scrollTop() + spacing;

    XXX_jitter *= -1;
    var skips = 0;

    for (i in hand) {
        var cd = $("#card_" + hand[i]);
        updateCardFlipState(cd, 999999);
        if (!collapsed) {
            if (currentX + cardWidth > handWidth) {
                currentY += cardHeight + spacing;
                currentX = startX;
            }
        }
        cd.addClass("inHand");
        cd.zIndex(kHandZIndex + parseInt(i));
        cd.data("stack_index", kHandZIndex + i);
        var xChanged = parseInt(currentX) != parseInt(cd.css('left'));
        var yChanged = parseInt(currentY) != parseInt(cd.css('top'));
        if (xChanged || yChanged) {
            cd.animate({
                left: currentX + (xChanged ? 0 : XXX_jitter),
                top: currentY + (yChanged ? 0 : XXX_jitter),
                opacity: 1.0,
            }, animationLength);
        } else {
            skips += 1;
        }
        if (collapsed) {
            currentX += collapsedHandSpacing;
        } else {
            currentX += cardWidth + spacing;
        }
    }
    log("hand animated with " + skips + " skips");
}

/* Forces a re-render of the hand after a handCache update. */
function redrawHand() {
    if (handCache) {
        renderHandStack(handCache);
    }
}

/* Forces re-render of cards on board. */
function redrawBoard() {
    $(".card").each(function(i) {
        var card = $(this);
        var key = card.data("dest_key");
        // Redraws cards that are not in some hand.
        if (!isNaN(key)) {
            var ds = heightOf(card.data("stack_index"));
            card.css("left", keyToX(key) + ds);
            card.css("top", keyToY(key) + ds);
        }
    });
    redrawDivider();
}

/* Sets position of center divider. */
function redrawDivider() {
    $("#divider").css("top", keyToY((kMaxGridIndex / 2) << 16));
}

/* Animates a card move to a destination on the board. */
function animateToKey(card, key) {
    log("animating #" + card.prop("id") + " -> " + key);
    var x = keyToX(key);
    var y = keyToY(key);
    var newX = x + heightOf(stackDepthCache[key] - 1);
    var newY = y + heightOf(stackDepthCache[key] - 1);
    updateCardFlipState(card, newY);
    var xChanged = parseInt(newX) != parseInt(card.css('left'));
    var yChanged = parseInt(newY) != parseInt(card.css('top'));
    XXX_jitter *= -1;
    if (xChanged || yChanged) {
        card.animate({
            left: newX + (xChanged ? 0 : XXX_jitter),
            top: newY + (yChanged ? 0 : XXX_jitter),
            opacity: 1.0,
            avoidTransforms: card.hasClass("rotated") || card.hasClass("flipped"),
        }, 'fast');
    } else {
        log("avoided animation");
    }
    card.removeClass("inHand");
}

/* Draws selection box about items. */
function createSelection(items) {
    selectedSet = items;
    if (selectedSet.length < 2) {
        updateFocus(selectedSet);
        $(".selecting").removeClass("selecting");
        hideSelectionBox();
        return;
    }
    var xVals = selectedSet.map(function(i) {
        return $(this).offset().left;
    });
    var yVals = selectedSet.map(function(i) {
        return $(this).offset().top;
    });
    var xValsWithCard = selectedSet.map(function(i) {
        var card = $(this);
        if (card.hasClass("rotated")) {
            return card.offset().left + kCardHeight;
        } else {
            return card.offset().left + kCardWidth;
        }
    });
    var yValsWithCard = selectedSet.map(function(i) {
        var card = $(this);
        if (card.hasClass("rotated")) {
            return card.offset().top + kCardWidth;
        } else {
            return card.offset().top + kCardHeight;
        }
    });
    var maxX = Math.max.apply(Math, xValsWithCard);
    var minX = Math.min.apply(Math, xVals);
    var maxY = Math.max.apply(Math, yValsWithCard);
    var minY = Math.min.apply(Math, yVals);

    if (selectedSet.hasClass("inHand")) {
        containmentHint = null;
    } else {
        // Produces hint with as small size as possible.
        var has = {};
        function genHint(card) {
            if (has[card.prop("id")] !== undefined) {
                return [];
            }
            log("has: " + card.prop("id"));
            has[card.prop("id")] = true;
            return [[card.hasClass("rotated"),
                     toCanonicalKey(card.data("dest_key")),
                     heightOf(card.data("stack_index"))]];
        }
        function extend(result, option) {
            if (option) {
                var hint = genHint(option);
                if (hint[0]) {
                    result.push(hint[0]);
                }
            }
        }
        containmentHint = selectedSet.map(function(t) {
            var card = $(this);
            if (stackDepthCache[card.data("dest_key")] > 1) {
                /* Includes top and bottom of each stack in selection. */
                var ext = extremes(stackOf(card));
                var result = [];
                extend(result, ext[2]);
                extend(result, ext[3]);
                extend(result, ext[4]);
                extend(result, ext[5]);
                return result;
            } else {
                var offset = card.offset();
                if (offset.left == minX) {
                    return genHint(card);
                }
                if (offset.top == minY) {
                    return genHint(card);
                }
                var rot = card.hasClass("rotated");
                var bottom = offset.top + (rot ? kCardWidth : kCardHeight);
                if (bottom == maxY) {
                    return genHint(card);
                }
                var right = offset.left + (rot ? kCardHeight : kCardWidth);
                if (right == maxX) {
                    return genHint(card);
                }
            }
            return [];
        });
        log("Containment hint size: "
            + containmentHint.length
            + ", total was " + selectedSet.length);
    }
    var boxAndArea = $("#selectionbox, #selectionarea");
    boxAndArea.css("left", minX - kSelectionBoxPadding);
    boxAndArea.css("top", minY - kSelectionBoxPadding);
    boxAndArea.css("width", maxX - minX + kSelectionBoxPadding * 2);
    boxAndArea.css("height", maxY - minY + kSelectionBoxPadding * 2);
    boxAndArea.show();
    $("#selectionbox span").text(selectedSet.length + " cards");
    updateFocus($("#selectionbox"), true);
}

$(document).ready(function() {
    document.addEventListener("touchstart", touchHandler, true);
    document.addEventListener("touchmove", touchHandler, true);
    document.addEventListener("touchend", touchHandler, true);
    document.addEventListener("touchcancel", touchHandler, true);
    document.addEventListener("touchleave", touchHandler, true);
    var connected = false;

    function initCards() {
        $(".card").disableSelection();

        $(".card").draggable({
            containment: $("#arena"),
            refreshPositions: true,
        });

        $(".card").each(function(index, card) {
            setOrientProperties($(card), getOrient($(card)));
        });

        $(".card").bind("dragstart", function(event, ui) {
            log("dragstart");
            var card = $(event.currentTarget);
            dragging = true;
            draggingId = card.prop("id");
            $("#hand").addClass("dragging");
            removeHoverMenu();
            if (card.hasClass("inHand")) {
                hasDraggedOffStart = true;
            } else {
                deactivateHand();
            }
            /* Slow on mobile.
            card.zIndex(kDraggingZIndex);
            */
            startDragProgress(card);
        });

        $(".card").bind("drag", function(event, ui) {
            var card = $(event.currentTarget);
            dragging = true;
            card.stop();
            updateDragProgress(card);
        });

        $(".card").bind("dragstop", function(event, ui) {
            var card = $(event.currentTarget);
            updateDragProgress(card, true);
            $("#hand").removeClass("dragging");
            dragging = false;
            removeFocus();
            var cardId = parseInt(card.prop("id").substr(5));
            var orient = card.data("orient");
            if (card.hasClass("inHand")) {
                var dest_prev_type = "hands";
            } else {
                var dest_prev_type = "board";
            }
            if ($("#hand").hasClass("active")) {
                deferDeactivateHand();
                var dest_type = "hands";
                var dest_key = user;
                // Assumes the server will put the card at the end of the stack.
                handCache.push(cardId);
                setOrientProperties(card, 1)
                redrawHand();
            } else {
                var dest_type = "board";
                var snap = findSnapPoint(card);
                if (snap != null) {
                    var dest_key = parseInt(findSnapPoint(card).data("dest_key"));
                } else {
                    var dest_key = keyFromTargetLocation(card);
                    log("offset: " + card.offset().left + "," + card.offset().top);
                    log("dest key computed is : " + dest_key);
                    card.data("dest_key", dest_key);
                }
                if (dest_prev_type == "hands") {
                    removeFromArray(handCache, cardId);
                    log("hand: " + JSON.stringify(handCache));
                    redrawHand();
                }
                card.zIndex(localMaxZ);
                localMaxZ += 1;
                animateToKey(card, dest_key);
            }
            log("Sending card move to " + dest_key);
            showSpinner();
            ws.send("move", {move: {card: cardId,
                                    dest_prev_type: dest_prev_type,
                                    dest_type: dest_type,
                                    dest_key: toCanonicalKey(dest_key),
                                    dest_orient: orient}});
            draggingId = null;
            dragStartKey = null;
        });

        $(".card").mousedown(function(event) {
            log("----------");
            var card = $(event.currentTarget);
            dragStartKey = card.data("dest_key");
            hasDraggedOffStart = false;
            if (card.hasClass("inHand")
                    && $("#hand").hasClass("collapsed")) {
                removeFocus();
            } else {
                activeCard = card;
                updateFocus(card, true);
            }
        });

        $(".card").mouseup(function(event) {
            var card = $(event.currentTarget);
            if (!dragging) {
                if ($(".selecting").length != 0) {
                    log("skipping mouseup when selecting");
                } else if (card.hasClass("inHand")
                        && $("#hand").hasClass("collapsed")) {
                    // Expands hand if a card is clicked while collapsed.
                    $("#hand").removeClass("collapsed");
                    redrawHand();
                } else if (hoverCardId != card.prop("id")) {
                    showHoverMenu(card);
                } else {
                    removeFocus();
                }
            }
            disableArenaEvents = true;
            dragging = false;
        });
    }

    /* Discards and redownloads all local state from the server. */
    function reset(state) {
        gameReady = true;
        animationLength = 0;
        log("Reset all local state.");
        $(".uuid_frame").remove();
        $(".card").remove();
        resourcePrefix = state.resource_prefix;
        handCache = [];

        function createImageNode(state, cid, stack_index) {
            var front_url = state.urls_small[cid] || state.urls[cid];
            var back_url = state.back_urls[cid] || state.default_back_url;
            var url = front_url;
            if (state.orientations[cid] == undefined) {
                state.orientations[cid] = -1;
            }
            if (state.orientations[cid] < 0) {
                url = back_url;
            }
            var img = '<img style="z-index: ' + state.zIndex[cid] + '; display: none"'
                + ' id="card_' + cid + '"'
                + ' data-orient="' + state.orientations[cid] + '"'
                + ' data-front="' + front_url + '"'
                + ' data-front_full="' + state.urls[cid] + '"'
                + ' data-back="' + back_url + '"'
                + ' data-stack_index="' + stack_index + '"'
                + ' class="card" src="' + toResource(url) + '">'
            return $(img).appendTo("#arena");
        }

        // Recreates the board.
        stackDepthCache = {};
        for (canonicalKey in state.board) {
            var stack = state.board[canonicalKey];
            var pos = toClientKey(canonicalKey);
            var x = keyToX(pos);
            var y = keyToY(pos);
            stackDepthCache[pos] = stack.length;
            for (z in stack) {
                var cid = stack[z];
                var card = createImageNode(state, cid, z);
                card.data("dest_key", pos);
                updateCardFlipState(card, y);
                card.animate({
                    left: x + heightOf(z),
                    top: y + heightOf(z),
                }, animationLength);
            }
        }
        log("height cache: " + JSON.stringify(stackDepthCache));

        // Recreates the hand.
        for (player in state.hands) {
            var hand = state.hands[player];
            for (i in hand) {
                var card = createImageNode(state, hand[i], i);
                card.data("dest_key", player);
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
        animationLength = kAnimationLength;
    }

    ws = $.websocket("ws:///" + hostname + ":" + kWSPort + "/kansas", {
        open: function() { warning("Websocket open (?)"); },
        close: function() { warning("Websocket closed (?)"); },
        events: {
            connect_resp: function(e) {
                connected = true;
                hideSpinner();
                log("Connected: " + e.data);
                $(".connected").show();
                reset(e.data[0]);
            },

            resync_resp: function(e) {
                hideSpinner();
                reset(e.data[0]);
            },

            broadcast_resp: function(e) {
                /* Ignores acks for the frame update messages we broadcast. */
            },

            error: function(e) {
                log("Server Error: " + e.msg);
            },

            reset: function(e) {
                hideSpinner();
                reset(e.data[0]);
            },

            stackupdate: function(e) {
                hideSpinner();
                log("Stack update: " + JSON.stringify(e.data));
                var clientKey = toClientKey(e.data.op.dest_key);
                var x = keyToX(clientKey);
                var y = keyToY(clientKey);

                /* Temporarily hides each card in the stack. */
                for (i in e.data.z_stack) {
                    var cd = $("#card_" + e.data.z_stack[i]);
                    cd.hide();
                }

                /* Redraws and shows each card in the stack. */
                for (i in e.data.z_stack) {
                    var cd = $("#card_" + e.data.z_stack[i]);
                    cd.css("left", x + heightOf(i));
                    cd.css("top", y + heightOf(i));
                    cd.data("stack_index", i);
                    cd.zIndex(e.data.z_index[i]);
                    localMaxZ = Math.max(localMaxZ, e.data.z_index[i]);
                    setOrientProperties(cd, e.data.orient[i]);
                    cd.fadeIn();
                }
            },

            update: function(e) {
                hideSpinner();
                log("Update: " + JSON.stringify(e.data));
                var card = $("#card_" + e.data.move.card);
                var clientKey = toClientKey(e.data.move.dest_key);
                var oldClientKey = toClientKey(e.data.old_key);
                card.data("dest_key", clientKey);

                if (e.data.old_type == "board") {
                    stackDepthCache[oldClientKey] -= 1;
                    if (stackDepthCache[oldClientKey] <= 0) {
                        if (stackDepthCache[oldClientKey] < 0) {
                            warning("Count cache is corrupted.");
                        } else {
                            delete stackDepthCache[oldClientKey];
                        }
                    }
                }

                if (e.data.move.dest_type == "board") {
                    stackDepthCache[clientKey] = e.data.z_stack.length;
                    log("stackDepthCache: " + JSON.stringify(stackDepthCache));

                    setOrientProperties(card, e.data.move.dest_orient);
                    var lastindex = e.data.z_stack.length - 1;
                    var x = keyToX(clientKey);
                    var y = keyToY(clientKey);
                    if (removeFromArray(handCache, e.data.move.card)) {
                        redrawHand();
                    }
                    for (i in e.data.z_stack) {
                        var cd = $("#card_" + e.data.z_stack[i]);
                        cd.data("stack_index", i);
                        if (i == lastindex) {
                            continue; // Skips last element for later handling.
                        }
// TODO fix up and enforce z-consistency for both source AND dest stacks
// currently this just screws up animation of multiple cards to the same stack
//                        cd.css("left", x + heightOf(i));
//                        cd.css("top", y + heightOf(i));
                    }
                    card.zIndex(e.data.z_index);
                    localMaxZ = Math.max(localMaxZ, e.data.z_index);
                    animateToKey(card, clientKey);
                } else if (e.data.move.dest_type == "hands") {

                    setOrientProperties(card, e.data.move.dest_orient);
                    if (clientKey == user) {
                        card.addClass("inHand");
                        renderHandStack(e.data.z_stack, true);
                    } else {
                        setOrientProperties(card, -1);
                        moveOffscreen(card);
                    }

                } else {
                    warning("unknown dest type: " + e.data.move.dest_type);
                }
            },

            broadcast_message: function(e) {
                log("Recv broadcast: " + JSON.stringify(e));
                switch (e.data.subtype) {
                    case "dragstart":
                        handleDragStartBroadcast(e);
                        break;
                    case "frameupdate":
                        handleFrameUpdateBroadcast(e);
                        break;
                }
            },
            _default: function(e) {
                log("Unknown response: " + JSON.stringify(e));
            },
        },
    });

    function tryConnect() {
        if (!connected) {
            showSpinner();
            ws.send("connect", {
                user: user,
                gameid: gameid,
            });
        }
    }

    $("#sync").mouseup(function(e) {
        showSpinner();
        ws.send("resync");
    });

    $("#reset").mouseup(function(e) {
        if (confirm("Are you sure you want to reset the game?")) {
            showSpinner();
            ws.send("reset");
        }
    });

    $("#debug").mouseup(function(e) {
        $("#console").toggle();
        loggingEnabled = !loggingEnabled;
    });

    $("#hand").droppable({
        over: function(event, ui) {
            if (ui.draggable.hasClass("card")) {
                var card = parseInt(ui.draggable.prop("id").substr(5));
                removeFromArray(handCache, card);
                if (!ui.draggable.hasClass("inHand")) {
                    redrawHand();
                }
                activateHand();
            }
        },
        out: function(event, ui) {
            if (ui.draggable.hasClass("card")) {
                var card = parseInt(ui.draggable.prop("id").substr(5));
                removeFromArray(handCache, card);
            }
            deactivateHand();
            if (dragging && !$("#hand").hasClass("collapsed")) {
                $("#hand").addClass("collapsed");
                redrawHand();
            }
        },
        tolerance: "touch",
    });

    $("#arena").disableSelection();
    $("body").disableSelection();
    $("html").disableSelection();
    $("#hand").disableSelection();

    $("#hand").mouseup(function(event) {
        log("hand click: show hand");
        if (!dragging && $(".selecting").length == 0) {
            if ($("#hand").hasClass("collapsed")) {
                $("#hand").removeClass("collapsed");
                redrawHand();
            }
        }
        removeFocus();
        disableArenaEvents = true;
    });

    $("#hand").mousedown(function(event) {
        disableArenaEvents = true;
    });

    $(".hovermenu li").live('mousedown', function(event) {
        var target = $(event.currentTarget);
        if (!target.hasClass("poisoned")) {
            target.addClass("hover");
        }
    });

    $(".hovermenu li").live('mouseup', function(event) {
        var target = $(event.currentTarget);
        if (target.hasClass("poisoned")) {
            return;
        }
        disableArenaEvents = true;
        var eventTable = {
            'flip': flipCard,
            'rotate': rotateCard,
            'unrotate': unrotateCard,
            'flipstack': flipStack,
            'shufstack': shuffleStack,
            'shufstackconfirm': shuffleStackConfirm,
            'stacknext': stackNext,
            'stackprev': stackPrev,
            'raise': raiseCard,
            'peek': peekCard,
        };
        var oldButtons = $(".hovermenu li");
        var action = eventTable[target.data("key")](activeCard);
        switch (action) {
            case "keepmenu": 
                oldButtons.not(target).addClass("disabled");
                break;
            case "disablethis":
                target.addClass("disabled");
                break;
            default:
                oldButtons.addClass("disabled");
                target.addClass("poison-source");
                removeFocus(true);
        }
        return false; /* Necessary for shufstackconfirm. */
    });

    $("#arena").selectable({
        distance: 50,
        appendTo: "#arena",
        start: function(e,u) {
            hideSelectionBox();
        },
        stop: function(event, ui) {
            createSelection($(".selecting"));
        },
        selecting: function(event, ui) {
            var elem = $(ui.selecting);
            var present = $(".selecting");
            var disallowed = null;
            if (present.length > 0) {
                disallowed = !present.hasClass("inHand");
            }
            if (elem.hasClass("card") && disallowed !== elem.hasClass("inHand")) {
                elem.addClass("selecting");
            }
        },
        unselecting: function(event, ui) {
            var elem = $(ui.unselecting);
            elem.removeClass("selecting");
        },
    });

    $("#selectionbox").draggable({
        /* Manual containment is used, since we manually resize the box. */
        delay: 300,
    });

    $("#selectionbox").mouseup(function(event) {
        var box = $("#selectionbox");
        updateFocus(box);
        if ($("#hand").hasClass("active")) {
            deferDeactivateHand();
            handleSelectionMovedToHand(selectedSet);
        } else {
            var delta = selectionBoxOffset();
            var x = delta[0];
            var y = delta[1];
            var dx = delta[2];
            var dy = delta[3];
            if (selectedSet.hasClass("inHand")) {
                handleSelectionMovedFromHand(selectedSet, x, y);
            } else {
                if (dx == 0 && dy == 0) {
                    handleSelectionClicked(selectedSet);
                } else {
                    handleSelectionMoved(selectedSet, dx, dy);
                }
            }
        }
    });

    $("#selectionbox").bind("dragstart", function(event, ui) {
        var box = $("#selectionbox");
        if (selectedSet.hasClass("inHand")) {
            $("#selectionarea").hide();
            var oldoffset = box.offset();
            box.width(kCardWidth + kSelectionBoxPadding * 2);
            box.height(kCardHeight + kSelectionBoxPadding * 2);
            box.css("margin-left", event.pageX - oldoffset.left - kCardWidth / 1.7);
            box.css("margin-top", event.pageY - oldoffset.top - kCardHeight);
        }
        startDragProgress(box);
        dragging = true;
    });

    $("#selectionbox").bind("drag", function(event, ui) {
        var box = $("#selectionbox");
        updateDragProgress(box);
        // Calculated manually because we sometimes resize the box.
        if (box.offset().top + box.outerHeight() - 3 < $("#hand").offset().top) {
            deactivateHand();
        }
        if (box.offset().top + box.outerHeight() > $("#hand").offset().top) {
            activateHand();
        }
    });

    $("#selectionbox").bind("dragstop", function(event, ui) {
        dragging = false;
    });

    $("#arena").mouseup(function(event) {
        if (disableArenaEvents) {
            disableArenaEvents = false;
        } else {
            removeFocus();
            if ($(".selecting").length == 0) {
                $("#hand").addClass("collapsed");
            }
            redrawHand();
        }
    });

    $("#arena").mousedown(function(event) {
        if (disableArenaEvents) {
            disableArenaEvents = false;
        } else {
            deactivateHand();
        }
    });

    if (window.innerHeight < kMinSupportedHeight) {
        $("#warning").show();
    }

    $(window).resize(function() {
        if (window.innerHeight < kMinSupportedHeight) {
            $("#warning").show();
        } else {
            $("#warning").hide();
        }
        redrawHand();
        redrawBoard();
    });

    redrawDivider();
    setTimeout(tryConnect, 1000);
    setTimeout(tryConnect, 2000);
    setTimeout(tryConnect, 5000);
});

// vim: et sw=4
