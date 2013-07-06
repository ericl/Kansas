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
 *      kansas_ui.vlog(level: int, msg)
 *      kansas_ui.warning(msg)
 */

/* TODO replace .inHand class with client.inHand(id|jquery{set}) ? */

function KansasUI() {
    this.view = null;
    this.client = null;
    this.user = null;
    this.uuid = null;
    this.hand_user = null;
    this.gameReady = false;
    this.animationLength = 0;
    this.lastFrameLocation = 0;
    this.lastFrameUpdate = 0;
    this.frameHideQueued = {};
    this.activeCard = null;
    this.draggingId = null;
    this.dragging = false;
    this.disableArenaEvents = false;
    this.dragStartKey = null;
    this.hasDraggedOffStart = false;
    this.hoverCardId = null;
    this.oldSnapCard = null;
    this.containmentHint = null;
    this.selectedSet = [];
    this.updateCount = 0;
    this.animationCount = 0;
    this.spinnerShowQueued = false;
    this.nextBoardZIndex = 200;
    this.nextHandZIndex = 4000000;
    this.eventTable = {};
}

(function() {  /* begin namespace kansasui */

// Tracks perf statistics.
var animationCount = 0;
var updateCount = 0;
var zChanges = 0;
var zShuffles = 0;

var originalZIndex = jQuery.fn.zIndex;
jQuery.fn.zIndex = function() {
    if (arguments.length > 0) {
        zChanges += 1;
    }
    return originalZIndex.apply(this, arguments);
}

var LOGLEVEL = 2;
var kAnimationLength = 400;

// TODO detect mobile devices better
var onMobile = navigator.platform.indexOf("android") >= 0;
var disableAccel = !onMobile; /* use higher quality when possible */
// Workaround for https://github.com/benbarnett/jQuery-Animate-Enhanced/issues/97
// TODO fix this - this makes for a terrible UI experience.
var XXX_jitter = onMobile ? 1 : 0;

// Minimum zIndexes for various states.
var kHandZIndex = 4000000;
var kDraggingZIndex = 4400000;

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

// Limits frame updates to 5fps.
var kFrameUpdatePeriod = 200;

/* XXX Returns [width, height] of arena. */
function getBBox() {
    return [
        $("#arena").outerWidth(),
        $("#arena").outerHeight() - kMinHandHeight,
    ];
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
KansasUI.prototype._computeContainmentHint = function(selectedSet, bb) {
    var minX = bb[0], minY = bb[1], maxX = bb[2], maxY = bb[3];
    var has = {};
    var that = this;
    function genHint(card) {
        if (has[card.prop("id")] !== undefined) {
            return [];
        }
        has[card.prop("id")] = true;
        return [[card.hasClass("rotated"),
                 that.client.getPos(card)[1],
                 heightOf(
                    card.data("stack_index"),
                    that.client.stackHeight(card))]];
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
        var loc = that.client.getPos(card)[1];
        if (has[loc]) {
            return [];
        }
        has[loc] = true;
        if (that.client.getStack('board', loc).length > 1) {
            /* Includes top and bottom of each stack in selection. */
            var ext = extremes(that.client.stackOf(card));
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
    this.vlog(2, "Containment hint size: "
        + containmentHint.length
        + ", total was " + selectedSet.length);
    return containmentHint;
}

/* Draws selection box about items. */
KansasUI.prototype._createSelection = function(items, popupMenu) {
    // On mobile, always pop up the hover menu,
    // since middle-click shortcuts are not possible.
    if (!onMobile) {
        popupMenu = false;
    }
    selectedSet = items;
    if (selectedSet.length < 2) {
        this._updateFocus(selectedSet);
        $(".selecting").removeClass("selecting");
        hideSelectionBox();
        if (selectedSet.length == 1) {
            that.activeCard = selectedSet;
            if (popupMenu) {
                this._showHoverMenu(selectedSet);
            }
        }
        return;
    }
    var bb = computeBoundingBox(selectedSet);
    var minX = bb[0], minY = bb[1], maxX = bb[2], maxY = bb[3];
    if (selectedSet.hasClass("inHand")) {
        containmentHint = null;
    } else {
        containmentHint = this._computeContainmentHint(selectedSet, bb);
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
    this._updateFocus($("#selectionbox"), true);
    if (popupMenu) {
        this._showHoverMenu(selectedSet);
    }
}

/**
 * Broadcasts location and highlights snap-to areas in a timely manner.
 */
KansasUI.prototype._updateDragProgress = function(target, force) {
    if ($.now() - this.lastFrameUpdate > kFrameUpdatePeriod || force) {
        this.lastFrameUpdate = $.now();
        var dest_key = this._keyFromTargetLocation(target);
        if (dest_key != this.lastFrameLocation) {
            this.hasDraggedOffStart = true;
            this.lastFrameLocation = dest_key;
            this._updateFocus(target);
        }
    }
}

/* Call this before updateDragProgress() */
KansasUI.prototype._startDragProgress = function(target) {
    lastFrameLocation = this._keyFromTargetLocation(target);
    if (target.hasClass("card")) {
        this.client.send("broadcast",
            {"subtype": "dragstart", "uuid": this.uuid, "card": target.prop("id")});
    } else if (target.prop("id") == "selectionbox") {
        // TODO send some other appropriate dragging hint
    }
    this._updateFocus(target);
}

/* Unselects all selected items, and hides hover menu. */
KansasUI.prototype._removeFocus = function(doAnimation) {
    this.vlog(3, "unfocus");
    this._removeHoverMenu(doAnimation);
    this._setSnapPoint(null);
    hideSelectionBox();
    $(".card").removeClass("highlight");
    $(".card").css("box-shadow", "none");
    if (this.gameReady) {
        this.client.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": true,
                "uuid": this.uuid,
            });
    }
}

/* Highlights new snap-to card, and unhighlights old one. */
KansasUI.prototype._setSnapPoint = function(snap) {
    var hand = $("#hand").hasClass("active");
    if (snap != null) {
        if (hand) {
            snap.removeClass("snappoint");
        } else {
            snap.addClass("snappoint");
        }
    }
    if (this.oldSnapCard != null) {
        if (snap == null) {
            this.oldSnapCard.removeClass("snappoint");
        } else if (this.oldSnapCard.prop("id") != snap.prop("id")) {
            this.oldSnapCard.removeClass("snappoint");
        }
    }
    this.oldSnapCard = snap;
}

/* Garbage collects older hovermenu image. */
KansasUI.prototype._removeHoverMenu = function(doAnimation) {
    var old = $(".hovermenu");
    this.hoverCardId = null;
    if (old.length > 0) {
        if (doAnimation) {
            old.fadeOut();
        } else {
            old.hide();
        }
        setTimeout(function() { old.remove(); }, 1000);
    }
}

/* Produces a location key from a jquery selection. */
// TODO move into KansasView... somehow?
KansasUI.prototype._keyFromTargetLocation = function(target) {
    return this._xKeyComponent(target) | (this._yKeyComponent(target) << 16);
}

/* Returns the x-key of the card in the client view. */
KansasUI.prototype._xKeyComponent = function(target) {
    var offset = target.offset();
    var left = offset.left;
    if (target.prop("id") != draggingId) {
      left -= heightOf(
        this.client.stackIndex(target),
        this.client.stackHeight(target));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        left -= parseInt(target.css("margin-left"));
    }
    // Normalize to grid width.
    var ratio = Math.min(1, Math.max(0, left / this.view.width));
    return Math.ceil(ratio * this.view.maxGridIndex);
}

/* Returns the y-key of the card in the client view. */
KansasUI.prototype._yKeyComponent = function(target) {
    var offset = target.offset();
    var tp = offset.top;
    if (target.prop("id") != draggingId) {
        tp -= heightOf(
            this.client.stackIndex(target),
            this.client.stackHeight(target));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        tp -= parseInt(target.css("margin-top"));
    }
    // Normalize to grid height.
    var ratio = Math.min(1, Math.max(0, tp / this.view.height));
    return Math.ceil(ratio * this.view.maxGridIndex);
}

/* Returns card at top of stack to snap to or NULL. */
KansasUI.prototype._findSnapPoint = function(target) {

    // Enforces that selections with more than 1 stack do not snap.
    if (target.prop("id") == "selectionbox") {
        var seen = {};
        var numStacks = 0;
        var that = this;
        $(".selecting").each(function(i) {
            var key = that.client.getPos($(this))[1];
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
    var cid = parseInt(targetId.substr(5));
    var x = target.offset().left;
    var y = target.offset().top;
    var w = target.width();
    var h = target.height();
    var minDist = Infinity;
    var closest = null;
    var that = this;

    $.each(this.client.listStacks('board'), function(i, pos) {
        if (that.client.getStackTop('board', pos) == cid) {
            var stack = that.client.getStack('board', pos);
            if (stack.length <= 1) {
                that.vlog(1, "ignoring pos " + pos);
                return;
            }
        }
        var coord = that.view.posToCoord(pos);
        var cx = coord[0], cy = coord[1];
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
            closest = pos;
        }
    });

    if (closest == null) {
        this.vlog(2, "No snap point for: " + target.prop("id"));
        return null;
    } else {
        var snap = this.client.getStackTop('board', closest);
        if (snap == cid) {
            var stack = that.client.getStack('board', closest);
            if (stack.length <= 1) {
                throw "should not have allowed this";
            }
            snap = stack[stack.length - 2];
        }
        this.vlog(2, "Snap point found for: " + target.prop("id")
            + ": card_" + snap);
        return $("#card_" + snap);
    }
}

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

/**
 * Broadcasts the location of target to other users, so that their clients
 * can draw a frame box where the card is being dragged.
 */
KansasUI.prototype._updateFocus = function(target, noSnap) {
    if (target.length == 0) {
        this.vlog(3, "Whoops, no focus.");
        this._removeFocus();
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

    var snap = noSnap ? null : this._findSnapPoint(target);
    this._setSnapPoint(snap);

    if (target.hasClass("inHand")) {
        this.vlog(3, "Target in hand - removing focus to keep movement private.");
        this.client.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": true,
                "uuid": this.uuid,
            });
        return;
    }

    // By default renders the fixed selection.
    var sizingInfo = this.containmentHint;
    if (isCard) {
        if (snap == null) {
            if (hasDraggedOffStart) {
                vlog(3, "Rendering free-dragging card.");
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this.view.toCanonicalKey(this._keyFromTargetLocation(target)), 0]];
            } else {
                this.vlog(3, "Rendering just-selected card on stack.");
                var count = this.client.stackHeight(target);
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this.client.getPos(target)[1],
                    heightOf(count - 1, count)]];
            }
        } else {
            this.vlog(3, "Rendering card snapping to stack");
            var count = this.client.stackHeight(snap);
            sizingInfo = [[
                snap.hasClass("rotated"),
                this.client.getPos(snap)[1],
                heightOf(count, count + 1)]];
        }
    } else if (snap != null) {
        this.vlog(3, "Rendering selection snapped to stack @ " + snap.data("dest_key"));
        var count = this.client.stackHeight(snap);
        sizingInfo = [[
            snap.hasClass("rotated"),
            this.client.getPos(snap)[1],
            heightOf(count, count + 1)]];
    } else if (sizingInfo != null) {
        vlog(3, "Rendering free-dragging selection");
        var delta = selectionBoxOffset();
        var dx = delta[2];
        var dy = delta[3];
        sizingInfo = $.map(sizingInfo, function(info) {
            var orig = toClientKey(info[1]);
            var current = keyFromCoords(keyToX(orig) + dx, keyToY(orig) + dy);
            return [[info[0], this.view.toCanonicalKey(current), info[2]]];
        });
    } else {
        this.vlog(3, "Not rendering selection in hand.");
        return;
    }

    this.client.send("broadcast",
        {
            "subtype": "frameupdate",
            "hide": false,
            "uuid": this.uuid,
            "name": this.user,
            "border": isCard ? 0 : kSelectionBoxPadding,
            "sizing_info": sizingInfo,
            "native_rotation": this.view.rotation,
        });
}

/* Returns topmost card in stack. */
function topOf(stack) {
    var maxZ = -1;
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
    $.each(stack, function(i, x) {
        var t = $("#card_" + x);
        var z = t.zIndex();
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
        var dest_key = this.client.getPos(snap)[1];
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

KansasUI.prototype._handleSelectionClicked = function(selectedSet, event) {
    if (event.which == 2) {
        // Implements middle-click-to-tap shortcut.
        if (selectedSet.hasClass("rotated")) {
            this._unrotateSelected();
        } else {
            this._rotateSelected();
        }
    } else if (this.hoverCardId != "#selectionbox") {
        this.disableArenaEvents = true;
        this._showHoverMenu(selectedSet);
    } else {
        this._removeFocus();
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
                dest_key: hand_user,
                dest_orient: getOrient(card)};
    });
}

/* Returns highest resolution image to display for card. */
KansasUI.prototype._highRes = function(card, reverse) {
    var orient = this.client.getOrient(card);
    if (reverse) {
        orient *= -1;
    }
    if (orient > 0) {
        return this.client.getFrontUrl(card);
    } else {
        return this.client.getBackUrl(card);
    }
}

/* Sets and broadcasts the visible orientation of the card. */
KansasUI.prototype._changeOrient = function(card, orient) {
    this._setOrientProperties(card, orient);
    this._updateFocus(card);
    this.view.startBulkMove().setOrient(card, orient).commit();
}

/* Remove selected cards. */
KansasUI.prototype._removeCard = function() {
    // extra card ID, (substr(5) == length of _card)
    var cards = $.map(selectedSet, function(x) {
        return parseInt(x.id.substr(5));   
    });
        
    this.client.send("remove", cards);   
}


KansasUI.prototype._toggleRotateCard = function(card) {
    var orient = getOrient(card);
    if (Math.abs(orient) == 1) {
        rotateCard(card);
    } else {
        unrotateCard(card);
    }
}

/* Rotates card to 90deg. */
KansasUI.prototype._rotateCard = function(card) {
    var orient = this.client.getOrient(card);
    if (Math.abs(orient) == 1) {
        this._changeOrient(card, Math.abs(orient) / orient * 2);
        $(".hovermenu")
            .children("img")
            .height(kCardHeight * kHoverTapRatio)
            .width(kCardWidth * kHoverTapRatio)
            .addClass("hoverRotate");
    }
}

/* Rotates card to 0deg. */
KansasUI.prototype._unrotateCard = function(card) {
    var orient = this.client.getOrient(card);
    if (Math.abs(orient) != 1) {
        this._changeOrient(card, Math.abs(orient) / orient);
        $(".hovermenu")
            .children("img")
            .removeClass("hoverRotate")
            .height(kCardHeight * kHoverCardRatio)
            .width(kCardWidth * kHoverCardRatio);
    }
}

/* Shows back of card. */
KansasUI.prototype._flipCard = function(card) {
    var orient = this.client.getOrient(card);
    if (orient > 0) {
        this._changeOrient(card, -this.client.getOrient(card));
        $(".hovermenu").children("img").prop("src", card.data("back"));
    }
}

/* Shows front of card. */
KansasUI.prototype._unflipCard = function(card) {
    var orient = this.client.getOrient(card);
    if (orient < 0) {
        this._changeOrient(card, -this.client.getOrient(card));
        $(".hovermenu").children("img").prop("src", card.data("front_full"));
    }
}

/* No-op that shows card privately in hovermenu. */
KansasUI.prototype._peekCard = function(card) {
    $(".hovermenu img").prop("src", this.client.getFrontUrl(card));
    return "disablethis";
}

/* Requests a stack inversion from the server. */
KansasUI.prototype._invertStack = function(memberCard) {
    var stack = stackOf(memberCard);
    var bottom = bottomOf(stack);
    $(".hovermenu").children("img").prop("src", this._highRes(bottom, true));
    this._createSelection(stack);
    showSpinner();
    ws.send("stackop", {op_type: "invert",
                        dest_type: "board",
                        dest_key: this.client.getPos(memberCard)[1]});
}

/* Requests a stack reverse from the server. */
KansasUI.prototype._reverseStack = function(memberCard) {
    var stack = stackOf(memberCard);
    var bottom = bottomOf(stack);
    $(".hovermenu").children("img").prop("src", highRes(bottom));
    this._createSelection(stack);
    showSpinner();
    ws.send("stackop", {op_type: "reverse",
                        dest_type: "board",
                        dest_key: this.client.getPos(memberCard)[1]});
}

KansasUI.prototype._shuffleSelectionConfirm = function() {
    if (selectedSet.length < 5) {
        return this._shuffleSelection();
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

KansasUI.prototype._removeConfirm = function() {
    var node = $(".removeconfirm");
    node.removeClass("removeconfirm");
    node.removeClass("hover");
    node.removeClass("poison-source");
    node.addClass("confirm");
    node.data("key", "remove");
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
KansasUI.prototype._shuffleSelection = function() {
    var that = this;
    var majorityKey = majority(selectedSet, function(x) {
        return that.client.getPos($(x))[1];
    });
    var exemplar = this.client.getStackTop('board', majorityKey);
    var orient = this.client.getOrient(exemplar);
    var txn = this.view.startBulkMove();
    selectedSet.each(function(index, card) {
        if (that.client.getPos(exemplar)[1] != that.client.getPos($(card))[1])
            txn.moveOnto($(card), exemplar);
    });
    txn.commit();
    this.client.send("stackop", {op_type: "shuffle",
                                 dest_type: "board",
                                 dest_key: parseInt(majorityKey)});
}

/* Goes from a single card to selecting the entire stack. */
KansasUI.prototype._cardToSelection = function(card) {
    this._createSelection(this._stackOf(card).addClass("highlight"), true);
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
        dest_key = hand_user;
        dest_prev_type = "hands";
    }
    return {card: cardId,
            dest_prev_type: dest_type,
            dest_type: dest_type,
            dest_key: toCanonicalKey(dest_key),
            dest_orient: getOrient(card)};
}

KansasUI.prototype._flipSelected = function() {
    var txn = this.view.startBulkMove();
    selectedSet.each(function() {
        txn.flip($(this));
    });
    txn.commit();
}

KansasUI.prototype._unflipSelected = function() {
    var txn = this.view.startBulkMove();
    selectedSet.each(function() {
        txn.unflip($(this));
    });
    txn.commit();
}

KansasUI.prototype._rotateSelected = function() {
    var txn = this.view.startBulkMove();
    selectedSet.each(function() {
        txn.rotate($(this));
    });
    txn.commit();
}

KansasUI.prototype._unrotateSelected = function() {
    var txn = this.view.startBulkMove();
    selectedSet.each(function() {
        txn.unrotate($(this));
    });
    txn.commit();
}

/* Shows hovermenu of prev card in stack. */
KansasUI.prototype._stackNext = function(memberCard) {
    var idx = parseInt(memberCard.data("stack_index")) - 1;
    var next = stackOf(memberCard).filter(function() {
        return $(this).data("stack_index") == idx;
    });
    this.activeCard = next;
    showHoverMenu(next);
    return "keepmenu";
}

/* Shows hovermenu of prev card in stack. */
KansasUI.prototype._stackPrev = function(memberCard) {
    var idx = parseInt(memberCard.data("stack_index")) + 1;
    var prev = stackOf(memberCard).filter(function() {
        return $(this).data("stack_index") == idx;
    });
    this.activeCard = prev;
    showHoverMenu(prev);
    return "keepmenu";
}

/**
 * Displays a large version of the card image at the center of the screen,
 * along with controls for the stack.
 */
KansasUI.prototype._showHoverMenu = function(card) {
    var old = $(".hovermenu");
    var oldimg = $(".hovermenu img");
    if (card.length > 1) {
        hoverCardId = "#selectionbox";
        var newNode = this._menuForSelection(card);
    } else {
        hoverCardId = card.prop("id");
        var newNode = this._menuForCard(card);
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

KansasUI.prototype._menuForSelection = function(selectedSet) {
    var that = this;
    this.vlog(2, "Hover menu for selection of size " + selectedSet.length);
    this.hoverCardId = "#selectionbox";

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
        + ' class="bottom removeconfirm" data-key="removeconfirm">Remove'
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
        if (that.client.getOrient(t) > 0) {
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

KansasUI.prototype._menuForCard = function(card) {
    this.vlog(2, "Hover menu for #" + hoverCardId
        + "@" + this.client.getPos(card)[1]);
    var numCards = this.client.stackHeight(card);
    var i = numCards - this.client.stackIndex(card);
    var src = this._toResource(this._highRes(card));
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

    if (this.client.getOrient(card) > 0) {
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
    if (this.client.getOrient(card) > 0 || card.hasClass("flipped")) {
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
            avoidTransforms: disableAccel,
        }, animationLength);
    }
}


/* Changes the visible orientation the card */
KansasUI.prototype._setOrientProperties = function(card, orient) {
    if (orient > 0) {
        card.prop("src", this._toResource(this.client.getSmallUrl(card)));
    } else {
        card.prop("src", this._toResource(this.client.getBackUrl(card)));
    }

    if (Math.abs(orient) == 2) {
        card.addClass("rotated");
    } else {
        card.removeClass("rotated");
    }
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

KansasUI.prototype.init = function(client, uuid, user, isPlayer1) {
    this.client = client;
    this.uuid = uuid;
    this.user = user;
    var that = this;
    if (isPlayer1) {
        this.hand_user = "Player 1";
        this.view = new KansasView(client, 0, [0, 0], getBBox());
    } else {
        this.hand_user = "Player 2";
        this.view = new KansasView(
            client, 2, [-kCardWidth, -kCardHeight], getBBox());
    }
    this._redrawDivider();


    document.addEventListener("touchstart", touchHandler, true);
    document.addEventListener("touchmove", touchHandler, true);
    document.addEventListener("touchend", touchHandler, true);
    document.addEventListener("touchcancel", touchHandler, true);
    document.addEventListener("touchleave", touchHandler, true);

    this.eventTable = {
        'flip': this._flipCard,
        'unflip': this._unflipCard,
        'flipall': this._flipSelected,
        'unflipall': this._unflipSelected,
        'rotate': this._rotateCard,
        'unrotate': this._unrotateCard,
        'rotateall': this._rotateSelected,
        'unrotateall': this._unrotateSelected,
        'flipstack': this._invertStack,
        'reversestack': this._reverseStack,
        'shufsel': this._shuffleSelection,
        'remove': this._removeCard,
        'removeconfirm': this._removeConfirm,
        'shufselconfirm': this._shuffleSelectionConfirm,
        'stacknext': this._stackNext,
        'stackprev': this._stackPrev,
        'peek': this._peekCard,
        'toselection': this._cardToSelection,
        'trivialmove': function() {
            $("#selectionbox span").css("opacity", 1);
             return "keepselection";
        },
    }

    $("#sync").mouseup(function(e) {
        this.client.send("resync");
    });

    $("#reset").mouseup(function(e) {
        if (confirm("Are you sure you want to reset the game?")) {
            this.client.send("reset");
        }
    });

    $("#end").mouseup(function(e) {
        if (confirm("Are you sure you want to end the game?")) {
            that.client.send("end");
            $("#error").remove();
            document.location.hash = "";
            document.location.reload();
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

    $("#add").mouseup(function(e) {
        if ($('#addtext').css('display') == 'none') {
            $('#addtext').toggle();
        }else {
            var cards = $('#addtext').val();
            cardNames = cards.split("\n");
            sendList = [];
            var regex = /^([0-9]+) ([a-zA-Z,\-\' ]+)$/;
            
            for (var i = 0; i < cardNames.length; i++) {
                var match = regex.exec(cardNames[i]);
                if (match != null) {
                var count = match[1];
                    for (var j = 0; j < count; j++) {
                        sendList[sendList.length] = {loc: 70321830, name: match[2]};
                    }
                }
            }
            if (sendList.length > 500)
                warning("Trying to add too many cards");
            else 
                ws.send('add', sendList);
            $('#addtext').toggle();
        }
    });

    $("#hand").droppable({
        over: function(event, ui) {
            if (ui.draggable.hasClass("card")) {
                var card = parseInt(ui.draggable.prop("id").substr(5));
                if (!ui.draggable.hasClass("inHand")) {
                    that._redrawHand();
                }
                that._activateHand();
            }
        },
        out: function(event, ui) {
            if (ui.draggable.hasClass("card")) {
                var card = parseInt(ui.draggable.prop("id").substr(5));
            }
            deactivateHand();
            if (dragging && !$("#hand").hasClass("collapsed")) {
                $("#hand").addClass("collapsed");
                that._redrawHand();
            }
        },
        tolerance: "touch",
    });

    $("#arena").disableSelection();
    $("body").disableSelection();
    $("html").disableSelection();
    $("#hand").disableSelection();

    $("#hand").mouseup(function(event) {
        that.vlog(2, "hand click: show hand");
        if (!that.dragging && $(".selecting").length == 0) {
            if ($("#hand").hasClass("collapsed")) {
                $("#hand").removeClass("collapsed");
                that._redrawHand();
            }
        }
        that._removeFocus();
        that.disableArenaEvents = true;
    });

    $("#hand").mousedown(function(event) {
        that.disableArenaEvents = true;
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
        that.disableArenaEvents = true;
        var oldButtons = $(".hovermenu li");
        var fn = that.eventTable[target.data("key")];
        if (!fn)
            throw "fn not defined: " + target.data("key");
        var action = fn.call(that, that.activeCard);
        switch (action) {
            case "keepmenu": 
                oldButtons.not(target).addClass("disabled");
                break;
            case "disablethis":
                target.addClass("disabled");
                break;
            case "keepselection":
                that._removeHoverMenu(true);
                break;
            case "refreshselection":
                that._showHoverMenu(selectedSet);
                break;
            default:
                oldButtons.addClass("disabled");
                that._removeFocus(true);
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
            that._createSelection($(".selecting"), true);
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
        that._updateFocus(box);
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
                if (that.dragging) {
                    handleSelectionMovedFromHand(selectedSet, x, y);
                } else {
                    that._handleSelectionClicked(selectedSet, event);
                }
            } else {
                if (dx == 0 && dy == 0) {
                    that._handleSelectionClicked(selectedSet, event);
                } else {
                    handleSelectionMoved(selectedSet, dx, dy);
                }
            }
        }
    });

    $("#selectionbox").bind("dragstart", function(event, ui) {
        that._removeHoverMenu();
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
        that.dragging = true;
    });

    $("#selectionbox").bind("drag", function(event, ui) {
        var box = $("#selectionbox");
        updateDragProgress(box);
        // Calculated manually because we sometimes resize the box.
        if (box.offset().top + box.outerHeight() - 3 < $("#hand").offset().top) {
            deactivateHand();
        }
        if (box.offset().top + box.outerHeight() > $("#hand").offset().top) {
            that._activateHand();
        }
    });

    $("#selectionbox").bind("dragstop", function(event, ui) {
        that.dragging = false;
    });

    $("#arena").mouseup(function(event) {
        if (that.disableArenaEvents) {
            that.disableArenaEvents = false;
        } else {
            that._removeFocus();
            if ($(".selecting").length == 0) {
                var h = $("#hand");
                if (!h.hasClass("collapsed")) {
                    h.addClass("collapsed");
                    that._redrawHand();
                }
            }
        }
    });

    $("#arena").mousedown(function(event) {
        if (that.disableArenaEvents) {
            that.disableArenaEvents = false;
        } else {
            deactivateHand();
        }
    });

    $(window).resize(function() {
        that._redrawHand();
        that._redrawBoard();
    });

    setInterval(function() {
        $("#stats")
            .text("anim: " + animationCount
              + ", updates: " + updateCount
              + ", out: " + that.client._ws.sendCount
              + ", in: " + that.client._ws.recvCount
              + ", zCh: " + zChanges
              + ", zShuf: " + zShuffles);
    }, 500);

    this._redrawDivider();
}

/* Forces re-render of cards on board. */
KansasUI.prototype._redrawBoard = function() {
    for (key in stackDepthCache) {
        redrawStack(key);
    }
    this._redrawDivider();
}

/* Sets position of center divider. */
KansasUI.prototype._redrawDivider = function() {
    $("#divider").fadeIn().css("top", this.view.height / 2);
}

/* Returns absolute url of a resource. */
KansasUI.prototype._toResource = function(url) {
    if (url && url.toString().substring(0,5) == "http:") {
        return url;
    } else {
        return this.client._game.state.resource_prefix + url;
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

/* Highlights hand to receive drops. */
KansasUI.prototype._activateHand = function() {
    deactivateQueued = false;
    $("#hand").addClass("active");
    if (this.oldSnapCard != null) {
        this.oldSnapCard.removeClass("snappoint");
        this.oldSnapCard = null;
    }
}

/* Ensures cards are all at hand level. */
KansasUI.prototype._raiseCard = function(card) {
    this.vlog(2, "raise card " + this.nextBoardZIndex + " " + card.prop("id"));
    card.zIndex(this.nextBoardZIndex);
    this.nextBoardZIndex += 1;
}

/* Returns all cards in the same stack as memberCard or optKey. */
KansasUI.prototype._stackOf = function(memberCard, optKey) {
    var client = this.client;
    var key = (optKey === undefined) ? this.client.getPos(memberCard)[1] : optKey;
    return $(".card").filter(function() {
        return client.getPos($(this))[1] == key;
    });
}

function pickle(card) {
    return [
        card.prop("src"),
        card.prop("id"),
        card.attr("class"),
        card.css("left"),
        card.css("top"),
    ];
}

function unpickle(imgNode, cdata) {
    imgNode.prop("src", cdata[0]);
    imgNode.prop("id", cdata[1]);
    imgNode.attr("class", cdata[2]);
    imgNode.css("left", cdata[3]);
    imgNode.css("top", cdata[4]);
}

/* Changes Z of cards, by changing the card around each Z.
 * This yields improved mobile performance for small deck shuffles.
 * Guarantees that cards will have z-indexes in increasing order as provided. */
KansasUI.prototype._fastZShuffle = function(cardIds) {
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
    zShuffles += 1;
}

/* Forces a re-render of the entire stack at the location. */
KansasUI.prototype._redrawStack = function(pos) {
    if (isNaN(pos)) {
        this.vlog(1, "convert redrawStack - redrawHand @ " + pos);
        this._redrawHand();
        return;
    }

    var stack = this.client.getStack('board', pos);
    if (stack) {
        this._fastZShuffle(stack);
        var that = this;
        $.each(stack, function(index, cid) {
            var card = $("#card_" + cid);
            that.vlog(3, "redraw " + cid);
            that._redrawCard(card);
        });
    }
}

/* Forces a re-render of the hand after a handCache update. */
KansasUI.prototype._redrawHand = function() {
    this.vlog(1, "redrawHand");
    var hand = this.client.getStack('hands', this.hand_user);
    if (!hand)
        hand = [];

    var kHandSpacing = 4;
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

    for (i in hand) {
        var cd = $("#card_" + hand[i]);
        updateCardFlipState(cd, 999999);
        this._setOrientProperties(cd, this.client.getOrient(cd));
        if (!collapsed) {
            if (currentX + cardWidth > handWidth) {
                currentY += cardHeight + kHandSpacing;
                currentX = startX;
            }
        }
        cd.zIndex(this.nextHandZIndex);
        this.nextHandZIndex += 1;
        var xChanged = parseInt(currentX) != parseInt(cd.css('left'));
        var yChanged = parseInt(currentY) != parseInt(cd.css('top'));
        if (xChanged || yChanged) {
            animationCount += 1;
            updateCount += 1;
            cd.animate({
                left: currentX + (xChanged ? 0 : XXX_jitter),
                top: currentY + (yChanged ? 0 : XXX_jitter),
                opacity: 1.0,
                avoidTransforms: disableAccel,
            }, this.animationLength);
        } else {
            skips += 1;
        }
        if (collapsed) {
            currentX += collapsedHandSpacing;
        } else {
            currentX += cardWidth + kHandSpacing;
        }
    }
    this.vlog(2, "hand animated with " + skips + " skips");
}

/* Animates a card move to a destination on the board. */
KansasUI.prototype._redrawCard = function(card) {
    this.updateCount += 1;
    var key = this.client.getPos(card)[1];
    var coord = this.view.getCoord(card);
    var x = coord[0];
    var y = coord[1];
    var idx = this.client.stackIndex(card);
    if (idx < 0) {
        idx = this.client.stackHeight(card);
    }
    var count = Math.max(idx + 1, this.client.stackHeight(card));
    var newX = x + heightOf(idx, count);
    var newY = y + heightOf(idx, count);
    updateCardFlipState(card, y);
    this._setOrientProperties(card, this.client.getOrient(card));
    var xChanged = parseInt(newX) != parseInt(card.css('left'));
    var yChanged = parseInt(newY) != parseInt(card.css('top'));
    XXX_jitter *= -1;
    if (xChanged || yChanged) {
        this.animationCount += 1;
        card.animate({
            left: newX + (xChanged ? 0 : XXX_jitter),
            top: newY + (yChanged ? 0 : XXX_jitter),
            opacity: 1.0,
            avoidTransforms: disableAccel || card.hasClass("rotated") || card.hasClass("flipped"),
        }, this.animationLength / 2);
    }
    card.removeClass("inHand");
}

/* Returns the y-key of the card in the client view. */
function normalizedY(target) {
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
    return tp;
}

function normalizedX(target) {
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
    return left;
}

KansasUI.prototype._initCards = function(sel) {
    var that = this;
    var client = this.client;

    sel.draggable({
        containment: $("#arena"),
        refreshPositions: true,
    });

    sel.each(function(index, card) {
        that._setOrientProperties($(card), client.getOrient($(card)));
    });

    sel.bind("dragstart", function(event, ui) {
        that.vlog(3, "dragstart");
        var card = $(event.currentTarget);
        that.dragging = true;
        draggingId = card.prop("id");
        $("#hand").addClass("dragging");
        that._removeHoverMenu();
        if (card.hasClass("inHand")) {
            hasDraggedOffStart = true;
        } else {
            deactivateHand();
        }
        /* Slow on mobile. */
        if (!onMobile) {
            card.zIndex(kDraggingZIndex);
        }
        that._startDragProgress(card);
    });

    sel.bind("drag", function(event, ui) {
        var card = $(event.currentTarget);
        that.dragging = true;
        card.stop();
        that._updateDragProgress(card);
    });

    sel.bind("dragstop", function(event, ui) {
        var card = $(event.currentTarget);
        that._updateDragProgress(card, true);
        that.dragging = false;
        that._removeFocus();
        that._raiseCard(card);
        $("#hand").removeClass("dragging");

        var txn = that.view.startBulkMove();

        if ($("#hand").hasClass("active")) {
            deferDeactivateHand();
            txn.moveToHand(card, that.hand_user);
            // Assumes the server will put the card at the end of the stack.
            that._setOrientProperties(card, 1);
        } else {
            var snap = that._findSnapPoint(card);
            if (snap != null) {
                txn.moveOnto(card, snap);
            } else {
                txn.move(card, normalizedX(card), normalizedY(card));
            }
        }

        txn.commit();

        that.draggingId = null;
        that.dragStartKey = null;
    });

    sel.mousedown(function(event) {
        that.vlog(3, "----------");
        var card = $(event.currentTarget);
        dragStartKey = card.data("dest_key");
        hasDraggedOffStart = false;
        if (card.hasClass("inHand")
                && $("#hand").hasClass("collapsed")) {
            that._removeFocus();
        } else {
            that.activeCard = card;
            that._updateFocus(card, true);
        }
    });

    sel.mouseup(function(event) {
        var card = $(event.currentTarget);
        if (!that.dragging) {
            if ($(".selecting").length != 0) {
                that.vlog(2, "skipping mouseup when selecting");
            } else if (that.client.getPos(card)[0] == "hands"
                    && $("#hand").hasClass("collapsed")) {
                // Expands hand if a card is clicked while collapsed.
                $("#hand").removeClass("collapsed");
                that._redrawHand();
                that.vlog(2, "expand hand");
            } else if (that.hoverCardId != card.prop("id")) {
                that.vlog(2, "case 3");
                // Taps/untaps by middle-click.
                if (event.which == 2) {
                    that._toggleRotateCard(card);
                    removeFocus();
                } else {
                    that._showHoverMenu(card);
                }
            } else {
                that.vlog(2, "case 4");
                removeFocus();
            }
        }
        that.disableArenaEvents = true;
        dragging = false;
    });
}

KansasUI.prototype.handleReset = function() {
    this.gameReady = true;
    this.animationLength = 0;
    this.vlog(3, "Reset all local state.");
    $(".uuid_frame").remove();
    $(".card").remove();
    var that = this;

    function createImageNode(cid) {
        that.nextBoardZIndex = Math.max(that.nextBoardZIndex, that.client.getZ(cid) + 1);
        var url = that.client.getSmallUrl(cid);
        if (that.client.getOrient(cid) < 0) {
            url = that.client.getBackUrl(cid);
        }
        var img = '<img style="z-index: ' + that.client.getZ(cid) + '; display: none"'
            + ' id="card_' + cid + '"'
            + ' class="card" src="' + that._toResource(url) + '">'
        return $(img).appendTo("#arena");
    }

    var cards = this.client.listAll();
    for (i in cards) {
        var cid = cards[i];
        var card = createImageNode(cid);
        if (this.client.getPos(cid)[0] == 'board') {
            updateCardFlipState(card, this.view.getCoord(cid)[1]);
            this._redrawCard(card);
        }
    }
    this._redrawHand();

    $(".card").fadeIn();
    this._initCards($(".card"));
    this.animationLength = kAnimationLength;
}

KansasUI.prototype.handleStackChanged = function(key) {
    var dest_t = key[0];
    var dest_k = key[1];
    this.vlog(1, "stackChanged @ " + key);
    this._redrawStack(dest_k);
}

KansasUI.prototype.handleBroadcast = function(data) {
}

KansasUI.prototype.handlePresence = function(data) {
}

KansasUI.prototype.showSpinner = function() {
    if (!this.client)
        return;
    if (!this.spinnerShowQueued && this.client._state != 'offline') {
        this.spinnerShowQueued = true;
        setTimeout(this._reallyShowSpinner, 500);
    }
}

KansasUI.prototype._reallyShowSpinner = function() {
    if (this.spinnerShowQueued && this.client._state != 'offline') {
        $("#spinner").show();
        this.spinnerShowQueued = false;
    }
}

KansasUI.prototype.hideSpinner = function() {
    this.spinnerShowQueued = false;
    $("#spinner").hide();
}

KansasUI.prototype.warning = function(msg) {
    console.log("WARNING: " + msg);
}

KansasUI.prototype.vlog = function(i, msg) {
    if (parseInt(i) <= LOGLEVEL) {
        console.log('[' + i + '] ' + msg);
    }
}

})();  /* end namespace kansasui */
