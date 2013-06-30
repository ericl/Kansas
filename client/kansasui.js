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
    this.dragStartKey = null;
    this.hasDraggedOffStart = false;
    this.hoverCardId = null;
    this.oldSnapCard = null;
    this.containmentHint = null;
    this.selectedSet = [];
    this.updateCount = 0;
    this.animationCount = 0;
    this.zraises = 0;
    this.spinnerShowQueued = false;
};

(function() {  /* begin namespace kansasui */

// TODO detect mobile devices better
var onMobile = navigator.platform.indexOf("android") >= 0;

var kAnimationLength = 400;

// Workaround for https://github.com/benbarnett/jQuery-Animate-Enhanced/issues/97
// TODO fix this - this makes for a terrible UI experience.
var XXX_jitter = 1;

// Minimum zIndexes for various states.
var kHandZIndex = 4000000;
var kDraggingZIndex = 4400000;
var nextHandZIndex = kHandZIndex;
var nextBoardZIndex = 200;

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
    this.log("unfocus")
    removeHoverMenu(doAnimation);
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
        this.client.stackHeight(target) || 0);
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
            this.client.stackHeight(target) || 0);
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
        this.log("No snap point for: " + target.prop("id"));
        return null;
    } else {
        var snap = topOf(stackOf(closest).not(target));
        this.log("Snap point found for: " + target.prop("id")
            + ": " + snap.data("dest_key"));
        return snap;
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


/**
 * Broadcasts the location of target to other users, so that their clients
 * can draw a frame box where the card is being dragged.
 */
KansasUI.prototype._updateFocus = function(target, noSnap) {
    if (target.length == 0) {
        log("Whoops, no focus.");
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
    var sizingInfo = this.containmentHint;
    if (isCard) {
        if (snap == null) {
            if (hasDraggedOffStart) {
                log("Rendering free-dragging card.");
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this.view.toCanonicalKey(this._keyFromTargetLocation(target)), 0]];
            } else {
                this.log("Rendering just-selected card on stack.");
                var count = this.client.stackHeight(target);
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this.view.toCanonicalKey(target.data("dest_key")),
                    heightOf(count - 1, count)]];
            }
        } else {
            log("Rendering card snapping to stack");
            var count = stackDepthCache[snap.data("dest_key")] || 0;
            sizingInfo = [[
                snap.hasClass("rotated"),
                this.view.toCanonicalKey(snap.data("dest_key")),
                heightOf(count, count + 1)]];
        }
    } else if (snap != null) {
        log("Rendering selection snapped to stack @ " + snap.data("dest_key"));
        var count = stackDepthCache[snap.data("dest_key")] || 0;
        sizingInfo = [[
            snap.hasClass("rotated"),
            this.view.toCanonicalKey(snap.data("dest_key")),
            heightOf(count, count + 1)]];
    } else if (sizingInfo != null) {
        log("Rendering free-dragging selection");
        var delta = selectionBoxOffset();
        var dx = delta[2];
        var dy = delta[3];
        sizingInfo = $.map(sizingInfo, function(info) {
            var orig = toClientKey(info[1]);
            var current = keyFromCoords(keyToX(orig) + dx, keyToY(orig) + dy);
            return [[info[0], this.view.toCanonicalKey(current), info[2]]];
        });
    } else {
        log("Not rendering selection in hand.");
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

KansasUI.prototype.init = function(client, uuid, user, isPlayer1) {
    this.client = client;
    this.uuid = uuid;
    this.user = user;
    if (isPlayer1) {
        this.hand_user = "Player 1";
        this.view = new KansasView(client, 0, [0, 0], getBBox());
    } else {
        this.hand_user = "Player 2";
        this.view = new KansasView(
            client, 2, [-kCardWidth, -kCardHeight], getBBox());
    }
};

/* Returns absolute url of a resource. */
KansasUI.prototype._toResource = function(url) {
    if (url && url.toString().substring(0,5) == "http:") {
        return url;
    } else {
        return this.client._game.state.resource_prefix + url;
    }
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

/* Removes highlight from hand. */
function deactivateHand() {
    deactivateQueued = false;
    $("#hand").removeClass("active");
}

/* Ensures cards are all at hand level. */
function fastZToBoard(card) {
    if (card.zIndex() >= kHandZIndex) {
        card.zIndex(nextBoardZIndex);
        nextBoardZIndex += 1;
    }
}

/* Returns all cards in the same stack as memberCard or optKey. */
KansasUI.prototype._stackOf = function(memberCard, optKey) {
    var client = this.client;
    var key = (optKey === undefined) ? memberCard.data("dest_key") : optKey;
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

/* Ensures card has the max z of the stack it is in.
 * Precondition: stack is already z-sorted except for card. */
KansasUI.prototype._fastZRaiseInStack = function(card) {
    var reverseSortedStack = this._stackOf(card)
        .not("#" + card.prop("id"))
        .sort(function(a, b) {
            return $(b).zIndex() - $(a).zIndex();
        });
    if (reverseSortedStack.length < 1) {
        this.log("no sorting necessary");
        return;
    }
    this.zraises += 1;
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

/* Forces a re-render of the entire stack at the location. */
KansasUI.prototype._redrawStack = function(clientKey, fixIndexes) {
    if (isNaN(clientKey)) {
        this.log("convert redrawStack - redrawHand @ " + clientKey);
        this._redrawHand();
        return;
    }

    var stack = this._stackOf(null, clientKey);
    if (fixIndexes) {
        stack.sort(function(a, b) {
            return $(a).data("stack_index") - $(b).data("stack_index");
        });
    }

    /* Recomputes position of each card in the stack. */
    var i = 0;
    var that = this;
    stack.each(function() {
        var cd = $(this);
        if (fixIndexes) {
            cd.data("stack_index", i);
            i += 1;
        }
        that.log("redraw " + cd);
        that._redrawCard(cd);
    });
}

/* Animates a card move to a destination on the board. */
KansasUI.prototype._redrawCard = function(card) {
    this.updateCount += 1;
    var key = this.client.getPos(card)[1];
    var coord = this.view.getCoord(card);
    var x = coord[0];
    var y = coord[1];
    var idx = this.client.stackIndex(card);
    var count = Math.max(idx + 1, this.client.stackHeight || 0);
    var newX = x + heightOf(idx, count);
    var newY = y + heightOf(idx, count);
    updateCardFlipState(card, newY);
    var xChanged = parseInt(newX) != parseInt(card.css('left'));
    var yChanged = parseInt(newY) != parseInt(card.css('top'));
    XXX_jitter *= -1;
    if (xChanged || yChanged) {
        this.animationCount += 1;
        card.animate({
            left: newX + (xChanged ? 0 : XXX_jitter),
            top: newY + (yChanged ? 0 : XXX_jitter),
            opacity: 1.0,
            avoidTransforms: card.hasClass("rotated") || card.hasClass("flipped"),
        }, this.animationLength / 2);
    }
    card.removeClass("inHand");
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
        that.log("dragstart");
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
        that._startDragProgress(card);
    });

    sel.bind("drag", function(event, ui) {
        var card = $(event.currentTarget);
        dragging = true;
        card.stop();
        that._updateDragProgress(card);
    });

    sel.bind("dragstop", function(event, ui) {
        var card = $(event.currentTarget);
        that._updateDragProgress(card, true);
        $("#hand").removeClass("dragging");
        dragging = false;
        that._removeFocus();
        var cardId = parseInt(card.prop("id").substr(5));
        var orient = that.client.getOrient(card);
        if (card.hasClass("inHand")) {
            var dest_prev_type = "hands";
        } else {
            var dest_prev_type = "board";
        }
        if ($("#hand").hasClass("active")) {
            deferDeactivateHand();
            var dest_type = "hands";
            var dest_key = hand_user;
            // Assumes the server will put the card at the end of the stack.
            setOrientProperties(card, 1)
            that._redrawHand();
        } else {
            var dest_type = "board";
            var snap = that._findSnapPoint(card);
            var oldKey = that.client.getPos(card)[1];
            if (snap != null) {
                var dest_key = parseInt(that._findSnapPoint(card).data("dest_key"));
            } else {
                var dest_key = that._keyFromTargetLocation(card);
                that.log("offset: " + card.offset().left + "," + card.offset().top);
                that.log("dest key computed is : " + dest_key);
            }
            if (dest_prev_type == "hands") {
                that.log("hand: " + JSON.stringify(handCache));
            }
            fastZToBoard(card);
            card = that._fastZRaiseInStack(card);
//            that._redrawStack(oldKey, true);
//            that._redrawStack(dest_key, false);
        }
        that.log("Sending card move to " + dest_key);
        that.showSpinner();

        /* Fixes orientation if the card is moved to the hand. */
        if (dest_type == "hands") {
            if (dest_prev_type == "board")
                orient = 1;
            else if (orient > 0)
                orient = 1;
            else
                orient = -1;
        }

        that.client.newBulkMoveTxn()
            .append(cardId, dest_type, dest_key, orient)
            .commit();

        draggingId = null;
        dragStartKey = null;
    });

    sel.mousedown(function(event) {
        that.log("----------");
        var card = $(event.currentTarget);
        dragStartKey = card.data("dest_key");
        hasDraggedOffStart = false;
        if (card.hasClass("inHand")
                && $("#hand").hasClass("collapsed")) {
            removeFocus();
        } else {
            activeCard = card;
            that._updateFocus(card, true);
        }
    });

    sel.mouseup(function(event) {
        var card = $(event.currentTarget);
        if (!dragging) {
            if ($(".selecting").length != 0) {
                that.log("skipping mouseup when selecting");
            } else if (card.hasClass("inHand")
                    && $("#hand").hasClass("collapsed")) {
                // Expands hand if a card is clicked while collapsed.
                $("#hand").removeClass("collapsed");
                that._redrawHand();
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

KansasUI.prototype.handleReset = function() {
    this.gameReady = true;
    this.animationLength = 0;
    this.log("Reset all local state.");
    $(".uuid_frame").remove();
    $(".card").remove();
    var that = this;

    function createImageNode(cid) {
        nextBoardZIndex = Math.max(nextBoardZIndex, that.client.getZ(cid) + 1);
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
        updateCardFlipState(card, this.view.getCoord(cid)[1]);
        this._redrawCard(card);
    }

    $(".card").fadeIn();
    this._initCards($(".card"));
    this.animationLength = kAnimationLength;
};

KansasUI.prototype.handleStackChanged = function(key) {
    var dest_t = key[0];
    var dest_k = key[1];
    this._redrawStack(dest_k, true);
};

KansasUI.prototype.handleBroadcast = function(data) {
};

KansasUI.prototype.handlePresence = function(data) {
};

KansasUI.prototype.showSpinner = function() {
    if (!this.client)
        return;
    if (!this.spinnerShowQueued && this.client._state != 'offline') {
        this.spinnerShowQueued = true;
        setTimeout(this._reallyShowSpinner, 500);
    }
};

KansasUI.prototype._reallyShowSpinner = function() {
    if (this.spinnerShowQueued && this.client._state != 'offline') {
        $("#spinner").show();
        this.spinnerShowQueued = false;
    }
}

KansasUI.prototype.hideSpinner = function() {
    this.spinnerShowQueued = false;
    $("#spinner").hide();
};

KansasUI.prototype.warning = function(msg) {
    console.log("WARNING: " + msg);
};

KansasUI.prototype.log = function(msg) {
    console.log(msg);
};

})();  /* end namespace kansasui */
