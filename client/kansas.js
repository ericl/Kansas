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

// TODO refactor this mudball

// Default settings for websocket connection.
var kWSPort = 8080
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);

// Global vars set by home screen, then used by init().
var gameid = "Unnamed Game";
var user = "Anonymous";

// Websocket and game state.
var ws = null;
var loggingEnabled = false;
var connect_pending = false;
var connected = false;
var disconnected = false;
var gameReady = false;

// TODO detect mobile devices better
var onMobile = navigator.platform.indexOf("android") >= 0;

// Tracks local state of the hand and zIndex of the topmost card.
var handCache = [];

// Minimum zIndexes for various states.
var kHandZIndex = 4000000;
var kDraggingZIndex = 4400000;
var nextHandZIndex = kHandZIndex;
var nextBoardZIndex = 200;

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
// TODO fix this - this makes for a terrible UI experience.
var XXX_jitter = 1;

// Set to kAnimationLength once initial load has completed.
var animationLength = 0;
var kAnimationLength = 400;

// Max index of discrete positions on one axis of the grid. Must be < 0xffff.
var kMaxGridIndex = 0x7ff;

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

var clientRotation = 0;
var clientTranslation = [0, 0];

function setGeometry(up) {
    if (up) {
        clientRotation = 0;
        clientTranslation = [0, 0];
    } else {
        clientRotation = 2;
        clientTranslation = [-kCardWidth, -kCardHeight];
    }
}

// Keeps mapping from key -> height
var stackDepthCache = {};

// Tracks perf statistics.
var animationCount = 0;
var updateCount = 0;
var sentCount = 0;
var recvCount = 0;
var zChanges = 0;

var originalZIndex = jQuery.fn.zIndex;
jQuery.fn.zIndex = function() {
    if (arguments.length > 0) {
        zChanges += 1;
    }
    return originalZIndex.apply(this, arguments);
};

/**
 * When cards are stacked on each other we want to provide a 3d-illusion.
 * heightOf() returns the proper x, y offset for cards in the stack.
 */
function heightOf(stackIndex, stackCount) {
    if (stackCount === undefined) {
        stackCount = 0;
    }
    if (stackIndex === undefined
            || isNaN(stackIndex)
            || stackIndex >= kHandZIndex) {
        return 0;
    }
    var kStackDelta = 2;
    if (stackCount == 2) {
        kStackDelta = 20;
    } else if (stackCount == 3) {
        kStackDelta = 14;
    } else if (stackCount == 4) {
        kStackDelta = 8;
    }
    var kMaxVisibleStackHeight = 7;
    if (stackIndex > kMaxVisibleStackHeight) {
        stackIndex = kMaxVisibleStackHeight;
    }
    return stackIndex * kStackDelta;
}

/* Returns all cards in the same stack as memberCard or optKey. */
function stackOf(memberCard, optKey) {
    var key = (optKey === undefined) ? memberCard.data("dest_key") : optKey;
    return $(".card").filter(function() {
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

/* Returns topmost card in stack. */
function bottomOf(stack) {
    var minZ = Infinity;
    var lowest = null;
    stack.each(function(i) {
        var z = $(this).zIndex();
        if (parseInt(z) < minZ) {
            minZ = z;
            lowest = $(this);
        }
    });
    return lowest;
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
    var snap = findSnapPoint($("#selectionbox"));
    if (snap != null) {
        var dest_key = toCanonicalKey(parseInt(snap.data("dest_key")));
        var innerFn = function(card) {
            var cardId = parseInt(card.prop("id").substr(5));
            return {card: cardId,
                    dest_prev_type: "board",
                    dest_type: "board",
                    dest_key: dest_key,
                    dest_orient: getOrient(card)};
        };
    } else {
        var innerFn = function(card) {
            var cardId = parseInt(card.prop("id").substr(5));
            var dest = card.data("dest_key");
            var key = keyFromCoords(keyToX(dest) + dx, keyToY(dest) + dy);
            return {card: cardId,
                    dest_prev_type: "board",
                    dest_type: "board",
                    dest_key: toCanonicalKey(key),
                    dest_orient: getOrient(card)};
        };
    }
    makeBulkMove(innerFn);
}

function handleSelectionClicked(selectedSet, event) {
    if (event.which == 2) {
        // Implements middle-click-to-tap shortcut.
        if (selectedSet.hasClass("rotated")) {
            unrotateSelected(selectedSet);
        } else {
            rotateSelected(selectedSet);
        }
    } else if (hoverCardId != "#selectionbox") {
        disableArenaEvents = true;
        showHoverMenu(selectedSet);
    } else {
        removeFocus();
    }
}

function handleSelectionMovedFromHand(selectedSet, x, y) {
    var snap = findSnapPoint($("#selectionbox"));
    if (snap != null) {
        var fixedKey = parseInt(snap.data("dest_key"));
    }
    makeBulkMove(function(card) {
        var cardId = parseInt(card.prop("id").substr(5));
        var key = (snap != null) ? fixedKey : keyFromCoords(x, y);
        return {card: cardId,
                dest_prev_type: "hands",
                dest_type: "board",
                dest_key: toCanonicalKey(key),
                dest_orient: getOrient(card)};
    });
}

function handleSelectionMovedToHand(selectedSet) {
    makeBulkMove(function(card) {
        var cardId = parseInt(card.prop("id").substr(5));
        return {card: cardId,
                dest_prev_type: "board",
                dest_type: "hands",
                dest_key: user,
                dest_orient: getOrient(card)};
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
function log(msg) {
    if (loggingEnabled) {
        var console = $('#console');
        console.append(msg + "\n");
        console.scrollTop(console[0].scrollHeight - console.outerHeight());
    }
}

/* Logs warning to debug console */
function warning(msg) {
    log(msg);
    $("#error").text(msg).show();
}

/**
 * Hack to map touch into mouse events, from
 * http://stackoverflow.com/questions/5186441/javascript-drag-and-drop-for-touch-devices
 */
function touchHandler(event) {
    event.preventDefault();
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

/* Returns highest resolution image to display for card. */
function highRes(card, reverse) {
    var orient = getOrient(card);
    if (reverse) {
        orient *= -1;
    }
    if (orient > 0) {
        return card.data("front_full");
    } else {
        return card.data("back");
    }
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
      left -= heightOf(target.data("stack_index"),
        stackDepthCache[target.data("dest_key")] || 0);
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
        tp -= heightOf(target.data("stack_index"),
            stackDepthCache[target.data("dest_key")] || 0);
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
    var selectionSource = null;
    if (target.prop("id") == "selectionbox") {
        var seen = {};
        var numStacks = 0;
        $(".selecting").each(function(i) {
            var key = $(this).data("dest_key");
            selectionSource = key;
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
    var kAxisThresholdPixels = 50;
    var targetId = target.prop("id");
    var x = target.offset().left;
    var y = target.offset().top;
    var w = target.width();
    var h = target.height();
    var minDist = Infinity;
    var closest = null;
    $(".card").each(function(i) {
        var node = $(this);
        if (!node.hasClass("inHand")
                && node.prop("id") != targetId
                && node.data("dest_key") != selectionSource) {
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
        log("No snap point for: " + target.prop("id"));
        return null;
    } else {
        var snap = topOf(stackOf(closest).not(target));
        log("Snap point found for: " + target.prop("id") + ": " + snap.data("dest_key"));
        return snap;
    }
}

/* Flips cards that are on the other side of the board. */
function updateCardFlipState(card, newY) {
    var y = (newY !== undefined) ? newY : card.offset().top
    var div = $("#divider").offset().top;
    if (y + card.height() < div) {
        card.addClass("flipped");
    } else if (y > div) {
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
        // TODO send some other appropriate dragging hint
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
                var count = stackDepthCache[target.data("dest_key")] || 0;
                sizingInfo = [[
                    target.hasClass("rotated"),
                    toCanonicalKey(target.data("dest_key")),
                    heightOf(count - 1, count)]];
            }
        } else {
            log("Rendering card snapping to stack");
            var count = stackDepthCache[snap.data("dest_key")] || 0;
            sizingInfo = [[
                snap.hasClass("rotated"),
                toCanonicalKey(snap.data("dest_key")),
                heightOf(count, count + 1)]];
        }
    } else if (snap != null) {
        log("Rendering selection snapped to stack @ " + snap.data("dest_key"));
        var count = stackDepthCache[snap.data("dest_key")] || 0;
        sizingInfo = [[
            snap.hasClass("rotated"),
            toCanonicalKey(snap.data("dest_key")),
            heightOf(count, count + 1)]];
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
    ws.send("bulkmove",
        {moves: [{
            card: cardId,
            dest_type: dest_type,
            dest_key: toCanonicalKey(dest_key),
            dest_prev_type: dest_type,
            dest_orient: orient}]});
}

/* Remove selected cards. */
function removeCard() {
    log(selectedSet);
    // extra card ID, (substr(5) == length of _card)
    var cards = $.map(selectedSet, function(x) {
        return parseInt(x.id.substr(5));   
    });
        
    ws.send("remove", cards);   
}


function toggleRotateCard(card) {
    var orient = getOrient(card);
    if (Math.abs(orient) == 1) {
        rotateCard(card);
    } else {
        unrotateCard(card);
    }
}

/* Rotates card to 90deg. */
function rotateCard(card) {
    var orient = getOrient(card);
    if (Math.abs(orient) == 1) {
        changeOrient(card, Math.abs(orient) / orient * 2);
        $(".hovermenu")
            .children("img")
            .height(kCardHeight * kHoverTapRatio)
            .width(kCardWidth * kHoverTapRatio)
            .addClass("hoverRotate");
    }
}

/* Rotates card to 0deg. */
function unrotateCard(card) {
    var orient = getOrient(card);
    if (Math.abs(orient) != 1) {
        changeOrient(card, Math.abs(orient) / orient);
        $(".hovermenu")
            .children("img")
            .removeClass("hoverRotate")
            .height(kCardHeight * kHoverCardRatio)
            .width(kCardWidth * kHoverCardRatio);
    }
}

/* Shows back of card. */
function flipCard(card) {
    var orient = getOrient(card);
    if (orient > 0) {
        changeOrient(card, -getOrient(card));
        $(".hovermenu").children("img").prop("src", card.data("back"));
    }
}

/* Shows front of card. */
function unflipCard(card) {
    var orient = getOrient(card);
    if (orient < 0) {
        changeOrient(card, -getOrient(card));
        $(".hovermenu").children("img").prop("src", card.data("front_full"));
    }
}

/* No-op that shows card privately in hovermenu. */
function peekCard(card) {
    var url = activeCard.data("front_full");
    var src = toResource(url);
    $(".hovermenu img").prop("src", activeCard.data("front_full"));
    return "disablethis";
}

/* Requests a stack inversion from the server. */
function invertStack(memberCard) {
    var dest_key = parseInt(memberCard.data("dest_key"));
    var stack = stackOf(memberCard);
    var bottom = bottomOf(stack);
    $(".hovermenu").children("img").prop("src", highRes(bottom, true));
    createSelection(stack);
    showSpinner();
    ws.send("stackop", {op_type: "invert",
                        dest_type: "board",
                        dest_key: toCanonicalKey(dest_key)});
}

/* Requests a stack reverse from the server. */
function reverseStack(memberCard) {
    var dest_key = parseInt(memberCard.data("dest_key"));
    var stack = stackOf(memberCard);
    var bottom = bottomOf(stack);
    $(".hovermenu").children("img").prop("src", highRes(bottom));
    createSelection(stack);
    showSpinner();
    ws.send("stackop", {op_type: "reverse",
                        dest_type: "board",
                        dest_key: toCanonicalKey(dest_key)});
}

function shuffleSelectionConfirm() {
    if (selectedSet.length < 5) {
        return shuffleSelection();
    }
    var node = $(".shufselconfirm");
    node.removeClass("shufselconfirm");
    node.removeClass("hover");
    node.removeClass("poison-source");
    node.addClass("confirm");
    node.data("key", "shufsel");
    node.html("You&nbsp;sure?");
    return "keepmenu";
}

/* Will return majority value in stream if there is one. */
function majority(stream, keyFn) {
    var majority = undefined;
    var ctr = 1;
    $.each(stream, function() {
        var item = keyFn(this);
        if (majority === undefined) {
            majority = item;
        } else {
            if (majority == item) {
                ctr += 1;
            } else if (ctr == 0) {
                majority = item;
                ctr = 1;
            } else {
                ctr -= 1;
            }
        }
    });
    return majority;
}

/* Shuffles majority if there is one, and puts leftover cards on top. */
function shuffleSelection() {
    showSpinner();
    var majorityKey = majority(selectedSet, function(x) {
        return parseInt($(x).data("dest_key"));
    });
    var canonicalKey = toCanonicalKey(majorityKey);
    var canonicalOrient = getOrient(topOf(stackOf(null, majorityKey)));
    ws.send("stackop", {op_type: "shuffle",
                        dest_type: "board",
                        dest_key: canonicalKey});
    makeBulkMove(function(card) {
        if (parseInt(card.data("dest_key")) != majorityKey) {
            var cardId = parseInt(card.prop("id").substr(5));
            return {card: cardId,
                    dest_prev_type: "board",
                    dest_type: "board",
                    dest_key: canonicalKey,
                    dest_orient: canonicalOrient};
        } else {
            return [];
        }
    });
}

/* Goes from a single card to selecting the entire stack. */
function cardToSelection(memberCard) {
    createSelection(stackOf(memberCard).addClass("highlight"), true);
    return "refreshselection";
}

/* Generates the move that does not move a card. */
function generateTrivialMove(card) {
    var cardId = parseInt(card.prop("id").substr(5));
    var dest_type = "board";
    var dest_prev_type = "board";
    var dest_key = parseInt(card.data("dest_key"));
    if (card.hasClass("inHand")) {
        dest_type = "hands";
        dest_key = user;
        dest_prev_type = "hands";
    }
    return {card: cardId,
            dest_prev_type: dest_type,
            dest_type: dest_type,
            dest_key: toCanonicalKey(dest_key),
            dest_orient: getOrient(card)};
}

function makeBulkMove(innerFn) {
    showSpinner();
    var sortedSet = selectedSet
        .sort(function(a, b) {
            return $(a).zIndex() - $(b).zIndex();
        });
    var moves = $.map(sortedSet, function(x) {
        var card = $(x);
        var move = innerFn(card);

        /* Fixes orientation if the card is moved to the hand. */
        if (move.dest_type == "hands") {
            if (move.dest_prev_type == "board")
                move.dest_orient = 1;
            else if (move.dest_orient > 0)
                move.dest_orient = 1;
            else
               move.dest_orient = -1;
        }

        return move;
    });
    ws.send("bulkmove", {moves: moves});
}

function flipSelected() {
    makeBulkMove(function(card) {
        var orient = getOrient(card);
        if (orient > 0) {
            var move = generateTrivialMove(card);
            move["dest_orient"] = -orient;
            return move;
        } else {
            return [];
        }
    });
}

function unflipSelected() {
    makeBulkMove(function(card) {
        var orient = getOrient(card);
        if (orient < 0) {
            var move = generateTrivialMove(card);
            move["dest_orient"] = -orient;
            return move;
        } else {
            return [];
        }
    });
}

function rotateSelected() {
    makeBulkMove(function(card) {
        var orient = getOrient(card);
        if (Math.abs(orient) == 1) {
            var move = generateTrivialMove(card);
            move["dest_orient"] = Math.abs(orient) / orient * 2;
            return move;
        } else {
            return [];
        }
    });
}

function unrotateSelected() {
    makeBulkMove(function(card) {
        var orient = getOrient(card);
        if (Math.abs(orient) != 1) {
            var move = generateTrivialMove(card);
            move["dest_orient"] = Math.abs(orient) / orient;
            return move;
        } else {
            return [];
        }
    });
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

var eventTable = {
    'flip': flipCard,
    'unflip': unflipCard,
    'flipall': flipSelected,
    'unflipall': unflipSelected,
    'rotate': rotateCard,
    'unrotate': unrotateCard,
    'rotateall': rotateSelected,
    'unrotateall': unrotateSelected,
    'flipstack': invertStack,
    'reversestack': reverseStack,
    'shufsel': shuffleSelection,
    'remove': removeCard,
    'shufselconfirm': shuffleSelectionConfirm,
    'stacknext': stackNext,
    'stackprev': stackPrev,
    'peek': peekCard,
    'toselection': cardToSelection,
    'trivialmove': function() {
        $("#selectionbox span").css("opacity", 1);
         return "keepselection";
    },
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
    var old = $(".hovermenu");
    var oldimg = $(".hovermenu img");
    if (card.length > 1) {
        hoverCardId = "#selectionbox";
        var newNode = menuForSelection(card);
    } else {
        hoverCardId = card.prop("id");
        var newNode = menuForCard(card);
    }

    var newImg = newNode.children("img");
    newNode.width(545);
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

function menuForSelection(selectedSet) {
    log("Hover menu for selection of size " + selectedSet.length);
    hoverCardId = "#selectionbox";

    var cardContextMenu = (''
        + '<li class="tapall boardonly top" style="margin-left: -130px"'
        + ' data-key="rotateall">Tap All</li>'
        + '<li style="margin-left: -130px"'
        + ' class="untapall boardonly" data-key="unrotateall">Untap All'
        + '</li>'
        + '<li style="margin-left: -130px"'
        + ' class="unflipall" data-key="unflipall">Reveal All'
        + '</li>'
        + '<li style="margin-left: -130px"'
        + ' class="flipall" data-key="flipall">Hide All'
        + '</li>'
        + '<li style="margin-left: -130px"'
        + ' class="boardonly shufselconfirm"'
        + ' data-key="shufselconfirm">Shuffle'
        + '</li>'
        + '<li style="margin-left: -130px"'
        + ' class="bottom remove" data-key="remove">Remove'
        + '</li>'
 
        );

    var height = kCardHeight * kHoverCardRatio;
    var width = kCardWidth * kHoverCardRatio;

    var allTapped = true;
    var allUntapped = true;
    var allFlipped = true;
    var allUnflipped = true;

    selectedSet.each(function() {
        var t = $(this);
        if (t.hasClass("rotated")) {
            allUntapped = false;
        } else {
            allTapped = false;
        }
        if (getOrient(t) > 0) {
            allFlipped = false;
        } else {
            allUnflipped = false;
        }
    });

    var html = ('<div class="hovermenu">'
        + '<img class="blueglow" style="height: '
        + height + 'px; width: ' + width + 'px;"'
        + '></img>'
        + '<ul class="hovermenu" style="float: right; width: 50px;">'
        + '<span class="header" style="margin-left: -130px">&nbsp;SELECTION</span>"'
        + cardContextMenu
        + '</ul>'
        + '<div class="hovernote"><span class="hoverdesc">' + selectedSet.length
        + ' cards selected</span></div>'
        + '</div>');

    var newNode = $(html).appendTo("body");
    if (allTapped) {
        $(".tapall").addClass("disabled");
    }
    if (allUntapped) {
        $(".untapall").addClass("disabled");
    }
    if (allFlipped) {
        $(".flipall").addClass("disabled");
    }
    if (allUnflipped) {
        $(".unflipall").addClass("disabled");
    }
    if (selectedSet.hasClass("inHand")) {
        $(".boardonly").addClass("disabled");
    }
    if (!allUntapped) {
        newNode
            .children("img")
            .height(kCardHeight * kHoverTapRatio)
            .width(kCardWidth * kHoverTapRatio)
            .addClass("hoverRotate");
    }
    return newNode;
}

function menuForCard(card) {
    log("Hover menu for #" + hoverCardId + "@" + card.data("dest_key"));
    var numCards = stackDepthCache[card.data("dest_key")] || 0;
    var i = numCards - parseInt(card.data("stack_index"));
    var src = toResource(highRes(card));
    var imgCls = '';
    if (card.hasClass("rotated")) {
        var tapFn =  '<li style="margin-left: -130px" class="boardonly"'
            + ' data-key="unrotate">Untap</li>'
        var height = kCardHeight * kHoverTapRatio;
        var width = kCardWidth * kHoverTapRatio;
        imgCls = "hoverRotate";
    } else {
        var tapFn =  '<li style="margin-left: -130px" class="boardonly"'
            + ' data-key="rotate">Tap</li>'
        var height = kCardHeight * kHoverCardRatio;
        var width = kCardWidth * kHoverCardRatio;
    }

    if (getOrient(card) > 0) {
        var flipFn = '<li class="top" style="margin-left: -130px"'
            + ' data-key=flip>Hide</li>';
    } else {
        var flipFn = '<li class="top" style="margin-left: -130px"'
            + ' data-key=unflip>Reveal</li>';
    }

    var cardContextMenu = (flipFn + tapFn
        + '<li style="margin-left: -130px"'
        + ' class="bottom nobulk peek boardonly" data-key="peek">Peek'
        + '</li>');

    var html = ('<div class="hovermenu">'
        + '<img class="' + imgCls + '" style="height: '
        + height + 'px; width: ' + width + 'px;"'
        + ' src="' + src + '"></img>'
        + '<ul class="hovermenu" style="float: right; width: 50px;">'
        + '<span class="header" style="margin-left: -130px">&nbsp;STACK</span>"'
        + '<li style="margin-left: -130px"'
        + ' class="top boardonly bulk"'
        + ' data-key="reversestack">Invert</li>'
        + '<li style="margin-left: -130px"'
        + ' class="bottom bulk boardonly"'
        + ' data-key="toselection"><i>More...</i></li>'
        + '<span class="header" style="margin-left: -130px">&nbsp;CARD</span>"'
        + cardContextMenu
        + '</ul>'
        + '<div class="hovernote">'
        + '<span class="hoverlink stackprev" data-key="stackprev">'
        + '&#11013;&nbsp;</span>'
        + '<span class="hoverdesc">Card ' + i + ' of ' + numCards + '</span>'
        + '<span class="hoverlink stacknext" data-key="stacknext">'
        + '&nbsp;&#10145;</span>'
        + '</div></div>');

    var newNode = $(html).appendTo("body");
    if (card.hasClass("inHand")) {
        $(".boardonly").addClass("disabled");
        $(".hovernote").hide();
    } else if (numCards > 1) {
        $(".hovernote").show();
        $(".boardonly").removeClass("disabled");
        $(".nobulk").addClass("disabled");
        if (i == 1) {
            $(".stackprev").addClass("disabled");
        } else if (i == numCards) {
            $(".stacknext").addClass("disabled");
        }
    } else {
        $(".hovernote").hide();
        $(".boardonly").removeClass("disabled");
        $(".bulk").addClass("disabled");
    }
    if (getOrient(card) > 0 || card.hasClass("flipped")) {
        $(".peek").addClass("disabled");
    }
    return newNode;
}

/* Moves a card offscreen - used for hiding hands of other players. */
function moveOffscreen(card) {
    var kOffscreenY = -300;
    var destX = 200;
    if (parseInt(card.css("top")) != kOffscreenY) {
        animationCount += 1;
        updateCount += 1;
        card.animate({
            left: (destX != parseInt(card.css("left"))) ? destX : destX + XXX_jitter,
            top: kOffscreenY,
            opacity: 1.0,
        }, animationLength);
    }
}

function pickle(card) {
    return [
        card.prop("src"),
        card.prop("id"),
        card.attr("class"),
        {
            orient: card.data("orient"),
            front: card.data("front"),
            front_full: card.data("front_full"),
            back: card.data("back"),
            stack_index: card.data("stack_index"),
            dest_key: card.data("dest_key"),
        },
        card.css("left"),
        card.css("top"),
    ];
}

function unpickle(imgNode, cdata) {
    imgNode.prop("src", cdata[0]);
    imgNode.prop("id", cdata[1]);
    imgNode.attr("class", cdata[2]);
    imgNode.data(cdata[3]);
    imgNode.css("left", cdata[4]);
    imgNode.css("top", cdata[5]);
}

/* Ensures card has the max z of the stack it is in.
 * Precondition: stack is already z-sorted except for card. */
var raises = 0;
function fastZRaiseInStack(card) {
    var reverseSortedStack = stackOf(card)
        .not("#" + card.prop("id"))
        .sort(function(a, b) {
            return $(b).zIndex() - $(a).zIndex();
        });
    if (reverseSortedStack.length < 1) {
        log("no sorting necessary");
        return;
    }
    raises += 1;
    var assignedSlot = null;
    var displacedCard = card;
    var displacedAttrs = pickle(card);
    // Pushes card down until z-index of stack is sorted again.
    for (i in reverseSortedStack) {
        var nextCard = $(reverseSortedStack[i]);
        if (nextCard.zIndex() > displacedCard.zIndex()) {
            if (assignedSlot == null) {
                assignedSlot = displacedCard;
            }
            var nextCardAttrs = pickle(nextCard);
            unpickle(nextCard, displacedAttrs);
            unpickle(displacedCard, nextCardAttrs);
            displacedAttrs = nextCardAttrs;
        } else {
            break;
        }
    }
    return assignedSlot == null ? card : assignedSlot;
}

/* Changes Z of cards, by changing the card around each Z.
 * This yields improved mobile performance for small deck shuffles.
 * Guarantees that cards will have z-indexes in increasing order as provided. */
var shuffles = 0;
function fastZShuffle(cardIds) {
    var minZ = Infinity;
    var attrs = $.map(cardIds, function(id) {
        var card = $("#card_" + id);
        minZ = Math.min(minZ, card.zIndex());
        return [pickle(card)];
    });
    var sortedSlots = $.map(cardIds, function(id) {
        return $("#card_" + id);
    }).sort(function(a, b) {
        return $(a).zIndex() - $(b).zIndex();
    });
    $.each(sortedSlots, function(i) {
        var card = $(this);
        var cardAttrs = attrs[i];
        unpickle(card, cardAttrs);
    });
    shuffles += 1;
}

/* Ensures cards are all at hand level. */
function fastZToHand(cardIds) {
    $.map(cardIds, function(id) {
        var card = $("#card_" + id);
        if (card.zIndex() < kHandZIndex) {
            card.zIndex(nextHandZIndex);
            nextHandZIndex += 1;
        }
    });
}

/* Ensures cards are all at hand level. */
function fastZToBoard(card) {
    if (card.zIndex() >= kHandZIndex) {
        card.zIndex(nextBoardZIndex);
        nextBoardZIndex += 1;
    }
}

/* Redraws user's hand given an array of cards present. */
function renderHandStack(hand) {
    handCache = hand;

    var kHandSpacing = 5;
    var kConsiderUnloaded = 20;
    var handWidth = $("#hand").outerWidth();
    var cardWidth = kCardWidth + 6;
    var cardHeight = kCardHeight + 6;
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
    var startX = kHandSpacing;
    var currentX = startX;
    var currentY = $("#hand").position().top - $(window).scrollTop() + kHandSpacing;

    XXX_jitter *= -1;
    var skips = 0;

    fastZToHand(hand);
    fastZShuffle(hand);
    for (i in hand) {
        var cd = $("#card_" + hand[i]);
        updateCardFlipState(cd, 999999);
        if (!collapsed) {
            if (currentX + cardWidth > handWidth) {
                currentY += cardHeight + kHandSpacing;
                currentX = startX;
            }
        }
        cd.addClass("inHand");
        cd.data("stack_index", kHandZIndex + i);
        var xChanged = parseInt(currentX) != parseInt(cd.css('left'));
        var yChanged = parseInt(currentY) != parseInt(cd.css('top'));
        if (xChanged || yChanged) {
            animationCount += 1;
            updateCount += 1;
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
            currentX += cardWidth + kHandSpacing;
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

/* Forces a re-render of the entire stack at the location. */
function redrawStack(clientKey, fixIndexes) {
    if (isNaN(clientKey)) {
        log("convert redrawStack - redrawHand @ " + clientKey);
        redrawHand();
        return;
    }

    var stack = stackOf(null, clientKey);
    if (fixIndexes) {
        stack.sort(function(a, b) {
            return $(a).data("stack_index") - $(b).data("stack_index");
        });
    }

    /* Recomputes position of each card in the stack. */
    var i = 0;
    stack.each(function() {
        var cd = $(this);
        if (fixIndexes) {
            cd.data("stack_index", i);
            i += 1;
        }
        redrawCard(cd);
    });
}

/* Forces re-render of cards on board. */
function redrawBoard() {
    for (key in stackDepthCache) {
        redrawStack(key, false);
    }
    redrawDivider();
}

/* Sets position of center divider. */
function redrawDivider() {
    $("#divider").fadeIn().css("top", keyToY((kMaxGridIndex / 2) << 16));
}

/* Animates a card move to a destination on the board. */
function redrawCard(card) {
    updateCount += 1;
    var key = card.data("dest_key");
    var x = keyToX(key);
    var y = keyToY(key);
    var idx = parseInt(card.data("stack_index"));
    var count = Math.max(idx + 1, stackDepthCache[key] || 0);
    var newX = x + heightOf(idx, count);
    var newY = y + heightOf(idx, count);
    updateCardFlipState(card, newY);
    var xChanged = parseInt(newX) != parseInt(card.css('left'));
    var yChanged = parseInt(newY) != parseInt(card.css('top'));
    XXX_jitter *= -1;
    if (xChanged || yChanged) {
        animationCount += 1;
        card.animate({
            left: newX + (xChanged ? 0 : XXX_jitter),
            top: newY + (yChanged ? 0 : XXX_jitter),
            opacity: 1.0,
            avoidTransforms: card.hasClass("rotated") || card.hasClass("flipped"),
        }, animationLength / 2);
    }
    card.removeClass("inHand");
}

/* Returns bounding box around selectedSet. */
function computeBoundingBox(selectedSet) {
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
    var minX = Math.min.apply(Math, xVals);
    var minY = Math.min.apply(Math, yVals);
    var maxX = Math.max.apply(Math, xValsWithCard);
    var maxY = Math.max.apply(Math, yValsWithCard);
    return [minX, minY, maxX, maxY];
}

/* Chooses minimum set from selectedSet that can recreate boundingBox. */
function computeContainmentHint(selectedSet, bb) {
    var minX = bb[0], minY = bb[1], maxX = bb[2], maxY = bb[3];
    var has = {};
    function genHint(card) {
        if (has[card.prop("id")] !== undefined) {
            return [];
        }
        has[card.prop("id")] = true;
        return [[card.hasClass("rotated"),
                 toCanonicalKey(card.data("dest_key")),
                 heightOf(
                    card.data("stack_index"),
                    stackDepthCache[card.data("dest_key")] || 0)]];
    }
    function extend(result, option) {
        if (option) {
            var hint = genHint(option);
            if (hint[0]) {
                result.push(hint[0]);
            }
        }
    }
    var containmentHint = selectedSet.map(function(t) {
        var card = $(this);
        var loc = card.data("dest_key");
        if (has[loc]) {
            return [];
        }
        has[loc] = true;
        if (stackDepthCache[loc] > 1) {
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
    return containmentHint;
}

/* Draws selection box about items. */
function createSelection(items, popupMenu) {
    // On mobile, always pop up the hover menu,
    // since middle-click shortcuts are not possible.
    if (!onMobile) {
        popupMenu = false;
    }
    selectedSet = items;
    if (selectedSet.length < 2) {
        updateFocus(selectedSet);
        $(".selecting").removeClass("selecting");
        hideSelectionBox();
        if (selectedSet.length == 1) {
            activeCard = selectedSet;
            if (popupMenu) {
                showHoverMenu(selectedSet);
            }
        }
        return;
    }
    var bb = computeBoundingBox(selectedSet);
    var minX = bb[0], minY = bb[1], maxX = bb[2], maxY = bb[3];
    if (selectedSet.hasClass("inHand")) {
        containmentHint = null;
    } else {
        containmentHint = computeContainmentHint(selectedSet, bb);
    }
    var boxAndArea = $("#selectionbox, #selectionarea");
    boxAndArea.css("left", minX - kSelectionBoxPadding);
    boxAndArea.css("top", minY - kSelectionBoxPadding);
    boxAndArea.css("width", maxX - minX + kSelectionBoxPadding * 2);
    boxAndArea.css("height", maxY - minY + kSelectionBoxPadding * 2);
    boxAndArea.show();
    $("#selectionbox span")
        .text(selectedSet.length + " cards")
        .css("opacity", onMobile ? 0 : 1);
    updateFocus($("#selectionbox"), true);
    if (popupMenu) {
        showHoverMenu(selectedSet);
    }
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
        nextBoardZIndex = Math.max(nextBoardZIndex, state.zIndex[cid] + 1);
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
        }
        redrawStack(pos, false);
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
            renderHandStack(hand);
        } else {
            for (i in hand) {
                moveOffscreen($("#card_" + hand[i]));
            }
        }
    }
    $(".card").fadeIn();
    initCards($(".card"));
    animationLength = kAnimationLength;
}

function initCards(sel) {
    sel.draggable({
        containment: $("#arena"),
        refreshPositions: true,
    });

    sel.each(function(index, card) {
        setOrientProperties($(card), getOrient($(card)));
    });

    sel.bind("dragstart", function(event, ui) {
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
        /* Slow on mobile. */
        if (!onMobile) {
            card.zIndex(kDraggingZIndex);
        }
        startDragProgress(card);
    });

    sel.bind("drag", function(event, ui) {
        var card = $(event.currentTarget);
        dragging = true;
        card.stop();
        updateDragProgress(card);
    });

    sel.bind("dragstop", function(event, ui) {
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
            var oldKey = card.data("dest_key");
            if (snap != null) {
                var dest_key = parseInt(findSnapPoint(card).data("dest_key"));
            } else {
                var dest_key = keyFromTargetLocation(card);
                log("offset: " + card.offset().left + "," + card.offset().top);
                log("dest key computed is : " + dest_key);
            }
            if (dest_prev_type == "hands") {
                removeFromArray(handCache, cardId);
                log("hand: " + JSON.stringify(handCache));
            }
            card.data("stack_index", stackDepthCache[dest_key] || 0);
            card.data("dest_key", dest_key);
            fastZToBoard(card);
            card = fastZRaiseInStack(card);
            redrawStack(oldKey, true);
            redrawStack(dest_key, false);
        }
        log("Sending card move to " + dest_key);
        showSpinner();

        /* Fixes orientation if the card is moved to the hand. */
        if (dest_type == "hands") {
            if (dest_prev_type == "board")
                orient = 1;
            else if (orient > 0)
                orient = 1;
            else
                orient = -1;
        }

        ws.send("bulkmove",
            {moves:
                [{card: cardId,
                  dest_prev_type: dest_prev_type,
                  dest_type: dest_type,
                  dest_key: toCanonicalKey(dest_key),
                  dest_orient: orient}]});
        draggingId = null;
        dragStartKey = null;
    });

    sel.mousedown(function(event) {
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

    sel.mouseup(function(event) {
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
                // Taps/untaps by middle-click.
                if (event.which == 2) {
                    toggleRotateCard(card);
                    removeFocus();
                } else {
                    showHoverMenu(card);
                }
            } else {
                removeFocus();
            }
        }
        disableArenaEvents = true;
        dragging = false;
    });
}

function init() {
    document.addEventListener("touchstart", touchHandler, true);
    document.addEventListener("touchmove", touchHandler, true);
    document.addEventListener("touchend", touchHandler, true);
    document.addEventListener("touchcancel", touchHandler, true);
    document.addEventListener("touchleave", touchHandler, true);
    showSpinner();

    connect_pending = true;
    ws.send("connect", {
        user: user,
        gameid: gameid,
        uuid: uuid,
    });

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

    $("#leave").mouseup(function(e) {
        document.location.hash = "";
        document.location.reload();
    });

    $("#debug").mouseup(function(e) {
        $("#console").toggle();
        $("#stats").show();
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

    $(".hovermenu li, .hoverlink").live('mouseup', function(event) {
        var target = $(event.currentTarget);
        if (target.hasClass("poisoned")) {
            return;
        }
        target.addClass("poison-source");
        disableArenaEvents = true;
        var oldButtons = $(".hovermenu li");
        var action = eventTable[target.data("key")](activeCard);
        switch (action) {
            case "keepmenu": 
                oldButtons.not(target).addClass("disabled");
                break;
            case "disablethis":
                target.addClass("disabled");
                break;
            case "keepselection":
                removeHoverMenu(true);
                break;
            case "refreshselection":
                showHoverMenu(selectedSet);
                break;
            default:
                oldButtons.addClass("disabled");
                removeFocus(true);
        }
        return false; /* Necessary for shufselconfirm. */
    });

    $("#arena").selectable({
        distance: 50,
        appendTo: "#arena",
        autoRefresh: true,
        start: function(e,u) {
            hideSelectionBox();
        },
        stop: function(event, ui) {
            createSelection($(".selecting"), true);
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
        distance: 50,
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
                if (dragging) {
                    handleSelectionMovedFromHand(selectedSet, x, y);
                } else {
                    handleSelectionClicked(selectedSet, event);
                }
            } else {
                if (dx == 0 && dy == 0) {
                    handleSelectionClicked(selectedSet, event);
                } else {
                    handleSelectionMoved(selectedSet, dx, dy);
                }
            }
        }
    });

    $("#selectionbox").bind("dragstart", function(event, ui) {
        removeHoverMenu();
        $("#selectionbox span").css("opacity", 1);
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
                var h = $("#hand");
                if (!h.hasClass("collapsed")) {
                    h.addClass("collapsed");
                    redrawHand();
                }
            }
        }
    });

    $("#arena").mousedown(function(event) {
        if (disableArenaEvents) {
            disableArenaEvents = false;
        } else {
            deactivateHand();
        }
    });

    $(window).resize(function() {
        redrawHand();
        redrawBoard();
    });

    setInterval(function() {
        $("#stats")
            .text("anim: " + animationCount
              + ", updates: " + updateCount
              + ", out: " + ws.sendCount
              + ", in: " + ws.recvCount
              + ", zCh: " + zChanges
              + ", zRa: " + raises
              + ", zShuf: " + shuffles);
    }, 500);

    redrawDivider();
}

$(document).ready(function() {

    try {
        var config = JSON.parse(document.cookie);
        if (config.orient == "orient_down") {
            $("#orient_down").prop("checked", true);
        }
        if (config.username) {
            $("#username").val(config.username);
        }
    } catch (err) {
        console.log("could not parse cookie: " + document.cookie);
    }

    if (document.location.hash) {
        $("#homescreen").hide();
    }

    ws = $.websocket("ws:///" + hostname + ":" + kWSPort + "/kansas", {
        open: function() {
            if (document.location.hash) {
                var arr = document.location.hash.split(":");
                user = arr[1];
                $("#username").val(user);
                gameid = arr[2];
                if (arr[0] == "#orient_up")
                    $("#orient_up").prop("checked", true);
                else if (arr[0] == "#orient_down")
                    $("#orient_down").prop("checked", true);
                enter();
            } else {
                ws.send("list_games");
            }
        },
        close: function() {
            warning("Connection Error.");
            disconnected = true;
            connected = false;
            hideSpinner();
        },
        events: {
            list_games_resp: function(e) {
                $("#gamelist_loading").hide();

                /* Avoids annoyance of buttons disappearing on unneeded refresh. */
                var needsRefresh = false;
                for (g in e.data) {
                    var nodeid = "#gnode_" + btoa(e.data[g].gameid).split("=")[0];
                    var node = $(nodeid);
                    if (!node || node.data("presence") != e.data[g].presence) {
                        needsRefresh = true;
                        break;
                    }
                }

                if (needsRefresh) {
                    $("#gamelist").empty();
                    for (g in e.data) {
                        var nodeid = "gnode_" + btoa(e.data[g].gameid).split("=")[0];
                        var online = "";
                        if (e.data[g].presence > 0)
                            online = " (" + e.data[g].presence + " online)";
                        var node = $("<div id='"
                            + nodeid
                            + "' class='gamechoice' data-presence="
                            + e.data[g].presence
                            + "><span>"
                            + e.data[g].gameid
                            + online
                            + "</span> <button class='entergame' data-gameid='"
                            + e.data[g].gameid
                            + "'>"
                            + "Join"
                            + "</button></div>"
                        ).appendTo("#gamelist");
                    }
                }
                setTimeout(function() {
                    if (!connect_pending) {
                        ws.send("list_games");
                    }
                }, 500);
            },

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
                warning("Server Error: " + e.msg);
            },

            reset: function(e) {
                hideSpinner();
                reset(e.data[0]);
            },

            stackupdate: function(e) {
                hideSpinner();
                log("Stack update: " + JSON.stringify(e.data));
                var clientKey = toClientKey(e.data.op.dest_key);
                fastZShuffle(e.data.z_stack);
                for (i in e.data.z_stack) {
                    var cd = $("#card_" + e.data.z_stack[i]);
                    setOrientProperties(cd, e.data.orient[i]);
                    cd.data("stack_index", i);
                }
                redrawStack(clientKey, false);
            },

            presence: function(e) {
                log("Presence changed: " + JSON.stringify(e.data));

                var present = {};
                for (i in e.data) {
                    present[e.data[i].uuid] = true;
                }

                $("#presence").text("Online: " +
                    $.map(e.data, function(d) {
                        if (d.uuid == uuid)
                            return d.name + " (self)";
                        else
                            return d.name;
                    }).join(", "));

                /* Removes frames of clients no longer present. */
                $.each($(".uuid_frame"), function(i) {
                    var frame = $(this);
                    if (!present[frame.prop("id")])
                        frame.hide();
                });
            },

            bulkupdate: function(e) {
                hideSpinner();
                log("BulkUpdate.");

                var redrawHandQueued = false;
                var handRedrawn = false;
                var redrawn = {};
                var queuedStackRedraws = {};

                for (i in e.data) {
                    var data = e.data[i];
                    var clientKey = toClientKey(data.dest_key);

                    for (j in data['updates']) {
                        var update = data['updates'][j];
                        var card = $("#card_" + update.move.card);
                        var oldClientKey = toClientKey(update.old_key);
                        card.data("dest_key", clientKey);

                        if (update.old_type == "board") {
                            stackDepthCache[oldClientKey] -= 1;
                            if (stackDepthCache[oldClientKey] <= 0) {
                                if (stackDepthCache[oldClientKey] < 0) {
                                    warning("Count cache is corrupted.");
                                } else {
                                    delete stackDepthCache[oldClientKey];
                                }
                            }
                        }
                        setOrientProperties(card, update.move.dest_orient);
                        if (update.move.dest_type == "board") {
                            if (removeFromArray(handCache, update.move.card)) {
                                redrawHandQueued = true;
                            }
                            fastZToBoard(card);
                            queuedStackRedraws[oldClientKey] = true;
                        } else if (update.move.dest_type == "hands") {
                            if (clientKey == user) {
                                card.addClass("inHand");
                                handCache = data.z_stack;
                            } else {
                                setOrientProperties(card, -1);
                                moveOffscreen(card);
                            }
                        }
                    }

                    stackDepthCache[clientKey] = data.z_stack.length;
                    for (i in data.z_stack) {
                      var cd = $("#card_" + data.z_stack[i]);
                      cd.data("stack_index", i);
                    }
                    if (data.dest_type == "board") {
                      fastZShuffle(data.z_stack);
                    }
                    redrawStack(clientKey);
                    log("redraw stack " + clientKey);
                    redrawn[clientKey] = true;
                }
                log("stackDepthCache: " + JSON.stringify(stackDepthCache));

                for (k in queuedStackRedraws) {
                    if (!redrawn[k]) {
                        redrawStack(k, true);
                    }
                }

                if (redrawHandQueued && !handRedrawn) {
                    redrawHand();
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

    function enter() {
        $("#homescreen").fadeOut('slow');
        $(".home-hidden").fadeIn('slow');
        var orient;
        user = $("#username").val();
        if ($("#orient_up").is(":checked")) {
            document.cookie = "user_a";
            orient = "orient_up";
            setGeometry(1);
        } else {
            document.cookie = "user_b";
            orient = "orient_down";
            setGeometry(0);
        }
        document.title = orient + ':' + user + ':' + gameid;
        document.location.hash = document.title;
        document.cookie = JSON.stringify({
            orient: orient,
            username: user,
        });
        init();

        /* Enforces that this function is only run once. */
        enter = function() {};
    };

    $("#newgame").click(function() {
        if ($("#gamename").val())
            gameid = $("#gamename").val();
        enter();
    });

    $(".entergame").live('click', function(event) {
        gameid = $(event.currentTarget).data("gameid");
        enter();
    });
});

// vim: et sw=4
