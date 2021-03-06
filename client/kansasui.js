/* Manages card rendering and user input / output.
 *
 * Defined methods for 'KansasUI' module:
 *
 *      var kansas_ui = new KansasUI();
 *      kansas_ui.init(client: KansasClient, uuid: str,
 *                     orient: "player1"|"player2")
 *          Called when the client has been connected to a game.
 *          No new methods should be bound to the client by kansasui.
 *
 *      kansas_ui.handleAdd(ids: list[int])
 *      kansas_ui.handleRemove(ids: list[int])
 *      kansas_ui.handleStackChanged(key: [str, str|int])
 *      kansas_ui.handleBroadcast(data: json)
 *      kansas_ui.handlePresence(data: json)
 *      kansas_ui.showSpinner()
 *      kansas_ui.hideSpinner()
 *      kansas_ui.vlog(level: int, msg)
 *      kansas_ui.warning(msg)
 *      kansas_ui.clear()
 */

function KansasUI() {
    this.view = null;
    this.client = null;
    this.user = null;
    this.user_id = null;
    this.gender = null;
    this.orient = null;
    this.uuid = null;
    this.gameid = null;
    this.hand_user = null;
    this.chatHistory = [];
    this.lastFrameLocation = 0;
    this.lastFrameUpdate = 0;
    this.frameHideQueued = {};
    this.activeCard = null;
    this.draggingId = null;
    this.dragging = false;
    this.initialized_once = false;
    this.disableArenaEvents = false;
    this.previewUrls = [];
    this.dragStartKey = null;
    this.hasDraggedOffStart = false;
    this.hoverCardId = null;
    this.oldSnapCard = null;
    this.browsingCard = null;
    this.containmentHint = null;
    this.selectedSet = [];
    this.decksAvail = [];
    this.nextBoardZIndex = 200;
    this.nextHandZIndex = 4000000;
    this.eventTable = {};
    this.searcher = null;
    this.oldtitle = null;
    this.deepenSelectionTimeoutId = null;
    this.firstTimeShowingPanel = true;
    this.lastSavedDeckContents = null;
    this.lastSavedDeckName = null;
    var that = this;
    setInterval(function() {
        if (!that.client || that.client._state != 'connected') {
            return;
        }
        var latency = that.client.queueLatencyMillis();
        if (latency > 200) {
            that.vlog(1, "Server latency is at " + latency + "ms");
        }
        if (latency > 1000) {
            that.showSpinner();
        } else {
            that.hideSpinner();
        }
    }, 1000);
}

(function() {  /* begin namespace kansasui */

var kDefaultDeckPanelHtml = "=== Welcome to the card browser ===<br><br>Use the search bar above to find cards and add them to your deck list. Then hit 'Preview' below to further edit your deck and add it to the board.<br><br>Tip: use Ctrl-F to jump to card search."

var isMobile = {
    Android: function() {
        return navigator.userAgent.match(/Android/i) ? true : false;
    },
    BlackBerry: function() {
        return navigator.userAgent.match(/BlackBerry/i) ? true : false;
    },
    iOS: function() {
        return navigator.userAgent.match(/iPhone|iPad|iPod/i) ? true : false;
    },
    Windows: function() {
        return navigator.userAgent.match(/IEMobile/i) ? true : false;
    },
    any: function() {
        return (isMobile.Android()
            || isMobile.BlackBerry()
            || isMobile.iOS()
            || isMobile.Windows());
    }
};

/**
 * Returns list of cards found in the following html blob.
 * Returns [cards_list, #cards].
 * Each element of cards_list is [#cards, card name, card comments].
 */
function extractCards(html) {
    var text = html
        .replace(/<br><div>/g, '<br>')
        .replace(/\<div[^\>\<]*\>/g, '\n')
        .replace(/\<br[^\>\<]*\>/g, '\n')
        .replace(/\<[^\>\<]+\>/g, '')
        .replace(/&nbsp;/g, ' ');
    var cardNames = text.split("\n");
    var validated = [];
    var regex = /^([0-9]+)\s+([^\s][^#]*)(.*)$/;
    var count = 0;
    for (i in cardNames) {
        var match = regex.exec(cardNames[i]);
        if (match != null) {
            validated.push([parseInt(match[1]), match[2], match[3]]);
            count += parseInt(match[1]);
        } else {
            validated.push([0, cardNames[i]]);
        }
    }
    while (validated.length > 0 && validated[validated.length - 1][1] == "") {
        validated.pop();
    }
    if (validated.length > 0 && validated[validated.length - 1][0] == 0) {
        validated.push([0, "", ""]);
    }
    return [validated, count];
}

function hideDeckPanel() {
    $('#deckpanel').animate({left:'-45%'}, 0);
    $("#search_preview").hide();
}

function placeCaretAtEnd(el) {
    el.focus();
    if (typeof window.getSelection != "undefined"
            && typeof document.createRange != "undefined") {
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } else if (typeof document.body.createTextRange != "undefined") {
        var textRange = document.body.createTextRange();
        textRange.moveToElementText(el);
        textRange.collapse(false);
        textRange.select();
    }
}

function deckPanelVisible() {
    return $('#deckpanel').offset().left >= 0;
}

KansasUI.prototype._showDeckPanel = function(cb, imm) {
    this._refreshDeckList();
    var panelLoadReq = null;
    if (this.firstTimeShowingPanel) {
        this.firstTimeShowingPanel = false;
        var that = this;
        panelLoadReq = this.client.callAsync('kvop', {
            'namespace': 'DeckPanel#' + that.user_id,
            'op': 'Get',
            'key': 'saved_panel_name_contents',
        }).then(function(data, context) {
            if (data.resp) {
                $("#deckinput").html(data.resp.html);
                $("#deckname").val(data.resp.name);
                that.lastSavedDeckContents = data.resp.html;
                that.lastSavedDeckName = data.resp.name;
            } else {
                that.client.callAsync("samplecards").then(function(data) {
                   var html = kDefaultDeckPanelHtml + "<br><br>";
                   for (i in data) {
                       html += data[i] + "<br>";
                   }
                   $("#deckinput").html(html);
                   context.done();  // from outer then()
                });
                return context.Pending;
            }
        });
        setInterval(function() {
            var text = $("#deckinput").html();
            var name = $("#deckname").val();
            if (text != that.lastSavedDeckContents || name != that.lastSavedDeckName) {
                that.lastSavedDeckContents = text;
                that.lastSavedDeckName = name;
                that.vlog(1, "Saved changed deck contents.");
                that.client.callAsync('kvop', {
                    'namespace': 'DeckPanel#' + that.user_id,
                    'op': 'Put',
                    'key': 'saved_panel_name_contents',
                    'value': {
                        'html': text,
                        'name': name,
                    },
                });
            }
        }, 1000);
    } else {
        panelLoadReq = new Future();
        panelLoadReq.done();
    }
    panelLoadReq.then(function() {
        $('#deckpanel').animate({left:'0%'}, imm ? 0 : 300, cb);
        if (!isMobile.any()) {
            $("#kansas_typeahead").select();
        }
    });
}

/**
 * Approximate inverse of extractCards. The pair can be used
 * to validate the syntax of card lists.
 * Returns [html, #cards total, #failed].
 */
var lastVerifiedUrls = {};
function cardsToHtml(cards, validclass, verifiedurls, usingPartialData) {
    var replacement = "";
    var count = 0;
    var failed = 0;
    var prev = undefined;
    if (!validclass) {
        validclass = "validated";
    }
    var next = undefined;
    for (i in cards) {
        /* skips redundant newlines */
        if (next && !(prev == "<br>" && next == prev)) {
            replacement += next;
        }
        prev = next;
        var card = cards[i];
        if (card[0] == 0) {
            if (card[1]) {
                next = "" + card[1] + "<br>";
            } else if (card[1] === null) {
                next = "";
            } else if (replacement != "") {
                next = "<br>";
            }
        } else if (verifiedurls) {
            var myclass = validclass;
            if (!verifiedurls[card[1]]) {
                if (usingPartialData) {
                    myclass = "";
                } else {
                    myclass = "invalid";
                    failed += card[0];
                }
            } else {
                count += card[0];
            }
            next = "<span class=" + myclass + ">"
                + card[0] + " " + card[1] + "</span><span>"
                + card[2] + "</span><br>";
        } else {
            var cls = validclass;
            if (lastVerifiedUrls[card[1]]) {
                cls = "validated"
            }
            count += card[0];
            next = "<span class=" + cls + ">"
                + card[0] + " " + card[1] + "</span><span>"
                + card[2] + "</span><br>";
        }
    }
    if (next && next != "<br>") {
        replacement += next;
    }
    if (verifiedurls) {
        lastVerifiedUrls = verifiedurls;
    }
    return [replacement, count, failed];
}

// Tracks perf statistics.
var animationCount = 0;
var zChanges = 0;
var zShuffles = 0;
var isRetina = window.devicePixelRatio > 1;

var originalZIndex = jQuery.fn.zIndex;
jQuery.fn.zIndex = function() {
    if (arguments.length > 0) {
        zChanges += 1;
    }
    return originalZIndex.apply(this, arguments);
}

var LOGLEVEL = 1;
var kAnimationLength = 400;

// Minimum zIndexes for various states.
var kHandZIndex = 4000000;
var kDraggingZIndex = 4400000;

// Geometry of cards.
var kCardWidth = 92;
var kCardHeight = 131;
var kCardBorder = 4;
var kRotatedOffsetLeft = -10;
var kRotatedOffsetTop = 25;
var kMinHandHeight = 60;
var kHoverCardRatio = 3.95;
var kHoverTapRatio = kHoverCardRatio * 0.875;
var kSelectionBoxPadding = 15;
var kMinSupportedHeight = 1000;

// Limits frame updates to 5fps.
var kFrameUpdatePeriod = 200;

/* Returns [width, height] of arena. */
function getBBox() {
    return [
        $("#arena").outerWidth(),
        $("#arena").outerHeight() - kMinHandHeight,
    ];
}

function zSorted(selectedSet) {
    return selectedSet
        .sort(function(a, b) {
            return $(a).zIndex() - $(b).zIndex();
        });
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
                    that.client.stackIndex(card),
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
    items.addClass("highlight").addClass("selecting");
    this.selectedSet = items;
    this.activeCard = null;
    if (this.selectedSet.length < 2) {
        this._updateFocus(this.selectedSet);
        $(".selecting").removeClass("selecting");
        hideSelectionBox();
        if (this.selectedSet.length == 1) {
            this.activeCard = this.selectedSet;
        }
        return;
    }
    var bb = computeBoundingBox(this.selectedSet);
    var minX = bb[0], minY = bb[1], maxX = bb[2], maxY = bb[3];
    if (this.client.inHand(this.selectedSet)) {
        this.containmentHint = null;
    } else {
        this.containmentHint = this._computeContainmentHint(this.selectedSet, bb);
    }
    var boxAndArea = $("#selectionbox, #selectionarea");
    boxAndArea.css("left", minX - kSelectionBoxPadding);
    boxAndArea.css("top", minY - kSelectionBoxPadding);
    boxAndArea.css("width", maxX - minX + kSelectionBoxPadding * 2);
    var height = maxY - minY + kSelectionBoxPadding * 2;
    boxAndArea.css("height", height);
    boxAndArea.show();
    $("#selectionbox span")
        .text(this.selectedSet.length + " cards")
        .css("opacity", 1);
    if (isMobile.any()) {
        $("#selectionbox span").css("bottom", (height + 5) + "px").css("left", 0);
    }
    this._updateFocus($("#selectionbox"), true);
}

/**
 * Broadcasts location and highlights snap-to areas in a timely manner.
 */
KansasUI.prototype._updateDragProgress = function(target, force) {
    if ($.now() - this.lastFrameUpdate > kFrameUpdatePeriod || force) {
        this.lastFrameUpdate = $.now();
        var dest_key = this._screenToPos(target);
        if (dest_key != this.lastFrameLocation) {
            this.hasDraggedOffStart = true;
            this.lastFrameLocation = dest_key;
            this._updateFocus(target);
        }
    }
}

/* Call this before updateDragProgress() */
KansasUI.prototype._startDragProgress = function(target) {
    lastFrameLocation = this._screenToPos(target);
    if (target.hasClass("card")) {
        this.client.send("broadcast",
            {"subtype": "dragstart",
             "uuid": this.uuid,
             "card": target.prop("id")});
    } else if (target.prop("id") == "selectionbox") {
        // TODO send an appropriate dragging hint (fading etc.)
    }
    this._updateFocus(target);
}

/* Unselects all selected items, and hides hover menu. */
KansasUI.prototype._removeFocus = function(doAnimation) {
    this.vlog(2, "unfocus");
    this._removeHoverMenu(doAnimation);
    this._setSnapPoint(null);
    $("#chatbox").blur();
    $("#kansas_typeahead").blur();
    $("#deckname").blur();
    $("#deckinput").blur();
    hideSelectionBox();
    $(".card").removeClass("highlight");
    $(".card").css("box-shadow", "none");
    this.selectedSet = [];
    this.client.send("broadcast",
        {
            "subtype": "frameupdate",
            "hide": true,
            "uuid": this.uuid,
        });
}

/* Highlights new snap-to card, and unhighlights old one. */
KansasUI.prototype._setSnapPoint = function(snap) {
    var hand = $("#hand").hasClass("active")
        || $("#opponenthand").hasClass("active");
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

/* Returns card at top of stack to snap to or NULL. */
KansasUI.prototype._findSnapPoint = function(target) {

    var forbiddenKey = null;

    // Enforces that selections with more than 1 stack do not snap.
    if (target.prop("id") == "selectionbox") {
        var seen = {};
        var numStacks = 0;
        var that = this;
        $(".selecting").each(function(i) {
            var key = that.client.getPos($(this))[1];
            forbiddenKey = key;
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
    var cid = toId(target);
    var x = target.offset().left;
    var y = target.offset().top;
    var w = target.width();
    var h = target.height();
    var minDist = Infinity;
    var closest = null;
    var that = this;

    $.each(this.client.listStacks('board'), function(i, pos) {
        if (pos == forbiddenKey) {
            that.vlog(3, "ignoring forbidden pos " + pos);
            return;
        }
        if (that.client.getStackTop('board', pos) == cid) {
            var stack = that.client.getStack('board', pos);
            if (stack.length <= 1) {
                that.vlog(3, "ignoring pos " + pos);
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
        this.vlog(3, "No snap point for: " + target.prop("id"));
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
        if (snap == undefined) {
            return null;
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
            || stackCount <= 0
            || isNaN(stackIndex)
            || stackIndex >= kHandZIndex) {
        return 0;
    }
    var stackHeight = 14;
    if (stackCount == 1) {
        stackHeight = 1;
    } else if (stackCount == 2) {
        stackHeight = 40;
    } else if (stackCount == 3) {
        stackHeight = 42;
    } else if (stackCount == 4) {
        stackHeight = 32;
    } else {
        stackHeight = 10 + Math.sqrt(stackCount - 5) * .85;
    }
    return stackIndex / stackCount * stackHeight;
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

    if (this.client.inHand(target)) {
        this.vlog(3, "Target in hand - removing focus to keep movement private.");
        this.client.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": true,
                "uuid": this.uuid,
            });
        return;
    }

    if ($("#hand").hasClass('active')) {
        this.client.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": false,
                "uuid": this.uuid,
                "name": this.user,
                "tohand": this.hand_user,
            });
        return;
    }

    if ($("#opposinghand").hasClass('active')) {
        this.client.send("broadcast",
            {
                "subtype": "frameupdate",
                "hide": false,
                "uuid": this.uuid,
                "name": this.user,
                "tohand": this.opposing_hand_user,
            });
        return;
    }

    // By default renders the fixed selection.
    var sizingInfo = this.containmentHint;
    if (isCard) {
        if (snap == null) {
            if (this.hasDraggedOffStart) {
                this.vlog(2, "Rendering free-dragging card.");
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this._screenToPos(target),
                    0]];
            } else {
                this.vlog(2, "Rendering just-selected card on stack.");
                var count = this.client.stackHeight(target);
                sizingInfo = [[
                    target.hasClass("rotated"),
                    this.client.getPos(target)[1],
                    heightOf(count - 1, count)]];
            }
        } else {
            this.vlog(2, "Rendering card snapping to stack");
            var count = this.client.stackHeight(snap);
            sizingInfo = [[
                target.hasClass("rotated"),
                this.client.getPos(snap)[1],
                heightOf(count, count + 1)]];
        }
    } else if (snap != null) {
        var count = this.client.stackHeight(snap);
        sizingInfo = [[
            snap.hasClass("rotated"),
            this.client.getPos(snap)[1],
            heightOf(count, count + 1)]];
    } else if (sizingInfo != null) {
        this.vlog(2, "Rendering free-dragging selection");
        var delta = selectionBoxOffset();
        var dx = delta[2];
        var dy = delta[3];
        var view = this.view;
        sizingInfo = $.map(sizingInfo, function(info) {
            var orig = view.posToCoord(info[1]);
            var updated = view.coordToPos(orig[0] + dx, orig[1] + dy);
            return [[info[0], updated, info[2]]];
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
KansasUI.prototype._handleDragStartBroadcast = function(data) {
    var card = $("#" + data.card);
    $.each(card.attr("class").split(" "), function(i, cls) {
        if (cls.substring(0,9) == "faded_by_") {
            card.removeClass(cls);
        }
    });
    card.addClass("faded_by_" + data.uuid);
    card.css("opacity", 0.6);
}

/* Invoked on receipt of a frame_update broadcast. */
KansasUI.prototype._handleFrameUpdateBroadcast = function(data) {
    var frame = $("#" + data.uuid);
    if (frame.length == 0 && !data.hide ) {
        var node = '<div class="uuid_frame" id="'
            + data.uuid + '"><span>'
            + data.name + '</span></div>';
        $("#arena").append(node);
        frame = $("#" + data.uuid);
    } else {
        frame.children("span").text(data.name);
    }
    var that = this;
    if (data.hide) {
        this.frameHideQueued[data.uuid] = true;
        setTimeout(function() {
            if (that.frameHideQueued[data.uuid]) {
                frame.hide();
                $(".faded_by_" + data.uuid).css("opacity", 1);
                that.frameHideQueued[data.uuid] = false;
            }
        }, 1500);
    } else if (data.tohand == this.hand_user) {
        this.frameHideQueued[data.uuid] = false;
        frame.width($("#hand").outerWidth() - 6);
        frame.height($("#hand").outerHeight());
        frame.css("left", 0);
        frame.css("top", $("#hand").offset().top);
        frame.removeClass("flipName");
        frame.show();
    } else if (data.tohand == this.opposing_hand_user) {
        this.frameHideQueued[data.uuid] = false;
        frame.width($("#opposinghand").outerWidth() - 6);
        frame.height(25);
        frame.css("left", $("#opposinghand").offset().left);
        frame.css("top", -6);
        frame.addClass("flipName");
        frame.show();
    } else {
        this.frameHideQueued[data.uuid] = false;
        var flipName = this.view.rotation != data.native_rotation;
        var init = data.sizing_info.pop();
        var pos = this.view.posToCoord(init[1]);
        var minX = pos[0] + init[2] + (init[0] ? kRotatedOffsetLeft : 0);
        var minY = pos[1] + init[2] + (init[0] ? kRotatedOffsetTop : 0);
        function getW(info) {
            return (info[0] ? kCardHeight : kCardWidth);
        }
        function getH(info) {
            return (info[0] ? kCardWidth : kCardHeight);
        }
        var maxX = minX + 2 * kCardBorder + getW(init);
        var maxY = minY + 2 * kCardBorder + getH(init);
        $.each(data.sizing_info, function(i, val) {
            var pos = that.view.posToCoord(val[1]);
            var x = pos[0] + val[2];
            var y = pos[1] + val[2];
            var dx = val[0] ? kRotatedOffsetLeft : 0;
            var dy = val[0] ? kRotatedOffsetTop : 0;
            minX = Math.min(minX, x + dx);
            minY = Math.min(minY, y + dy);
            var w = 2 * kCardBorder + getW(val);
            var h = 2 * kCardBorder + getH(val);
            maxX = Math.max(maxX, x + dx + w);
            maxY = Math.max(maxY, y + dy + h);
        });
        frame.width(maxX - minX - 6 + 2 * data.border);
        frame.height(maxY - minY - 6 + 2 * data.border);
        frame.css("left", minX - data.border);
        frame.css("top", minY - data.border);
        if (flipName) {
            frame.addClass("flipName");
        } else {
            frame.removeClass("flipName");
        }
        frame.show();
    }
}

KansasUI.prototype._handleSelectionMoved = function(selectedSet, dx, dy) {
    var snap = this._findSnapPoint($("#selectionbox"));
    var txn = this.view.startBulkMove();
    if (snap != null) {
        $.each(zSorted(selectedSet), function() {
            txn.moveOnto($(this), snap);
        });
    } else {
        var that = this;
        $.each(zSorted(selectedSet), function() {
            var coord = that.view.getCoord($(this));
            var x = coord[0] + dx;
            var y = coord[1] + dy;
            txn.move($(this), x, y);
        });
    }
    txn.commit();
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
        if (this.deepenSelectionTimeoutId == null) {
            this._showHoverMenu(selectedSet);
        } else {
            this.vlog(0, "not showing menu due to deepened selection");
            clearTimeout(this.deepenSelectionTimeoutId);
            this.deepenSelectionTimeoutId = null;
        }
    } else {
        if (!this.client.inHand(selectedSet)) {
            var txn = this.view.startBulkMove();
            var that = this;
            var num_rotated = 0;
            var num_unrotated = 0;
            $.each(selectedSet, function() {
                var orient = that.client.getOrient($(this));
                if (Math.abs(orient) == 1) {
                    num_unrotated += 1;
                } else {
                    num_rotated += 1;
                }
            });
            $.each(zSorted(selectedSet), function() {
                var orient = that.client.getOrient($(this));
                if (num_unrotated > num_rotated) {
                    txn.rotate($(this));
                } else {
                    txn.unrotate($(this));
                }
            });
            txn.commit();
        }
        this._removeFocus();
    }
}

KansasUI.prototype._handleSelectionMovedFromHand = function(selectedSet, x, y) {
    var snap = this._findSnapPoint($("#selectionbox"));
    var txn = this.view.startBulkMove();
    $.each(zSorted(selectedSet), function() {
        if (snap != null) {
            txn.moveOnto($(this), snap);
        } else {
            txn.move($(this), x, y);
        }
    });
    txn.commit();
}

KansasUI.prototype._handleSelectionMovedToOpposingHand = function(selectedSet) {
    var txn = this.view.startBulkMove();
    var user = this.opposing_hand_user;
    $.each(zSorted(selectedSet), function() {
        txn.moveToHand($(this), user);
    });
    txn.commit();
}

KansasUI.prototype._handleSelectionMovedToHand = function(selectedSet) {
    var txn = this.view.startBulkMove();
    var user = this.hand_user;
    $.each(zSorted(selectedSet), function() {
        txn.moveToHand($(this), user);
    });
    txn.commit();
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
    var num = 0;
    if (this.selectedSet.length > 0) {
        var cards = $.map(this.selectedSet, toId);
        this.client.callAsync("remove", cards);
        num = cards.length;
    } else {
        this.client.callAsync("remove", [toId(this.activeCard)]);
        num = 1;
    }
    this.fyi(this.user + " has removed " + num + " cards.");
}


KansasUI.prototype._toggleRotateCard = function(card) {
    var orient = this.client.getOrient(card);
    if (Math.abs(orient) == 1) {
        this._rotateCard(card);
    } else {
        this._unrotateCard(card);
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
        $(".hovermenu").children("img").prop(
            "src", this.client.getBackUrl(card));
    }
}

/* Shows front of card. */
KansasUI.prototype._unflipCard = function(card) {
    var orient = this.client.getOrient(card);
    if (orient < 0) {
        this._changeOrient(card, -this.client.getOrient(card));
        $(".hovermenu").children("img").prop("src",
            this.client.getFrontUrl(card));
    }
}

/* No-op that shows card privately in hovermenu. */
KansasUI.prototype._peekCard = function(card) {
    var mycard = !card.hasClass("flipped");
    if (mycard) {
        this.fyi(this.user + " peeked at one of " + this.pronoun() + " cards.");
    } else {
        this.fyi(this.user + " peeked at one of " + this.pronoun() + " opponent's cards.");
    }
    $(".hovermenu img").prop("src", this.client.getFrontUrl(card));
    return "disablethis";
}

/* Requests a stack reverse from the server. */
KansasUI.prototype._reverseStack = function(memberCard) {
    var stack = this.client.stackOf(memberCard);
    var bottom = stack[0];
    $(".hovermenu").children("img").prop("src", this._highRes(bottom));
    var txn = this.view.startBulkMove();
    var i = stack.length - 1;
    while (i >= 0) {
        txn.moveOnto(stack[i], bottom);
        i -= 1;
    }
    txn.commit();
}

KansasUI.prototype._browseStack = function(memberCard, useSelection) {
    this.browsingCard = memberCard;
    var mine = true;
    if (useSelection) {
        var stack = [];
        this.selectedSet.map(function(i) {
            var card = $(this);
            if (card.hasClass("flipped")) {
                mine = false;
            }
            var ans = toId(card);
            if (!isNaN(ans)) {
                stack.push(ans);
            }
        });
    } else {
        var stack = this.client.stackOf(memberCard);
        if (memberCard.hasClass("flipped")) {
            mine = false;
        }
    }
    shuffle(stack, 1);
    var that = this;
    var c = this.client;
    var s = this.searcher;
    var cards = [];
    var counts = {};
    for (i in stack) {
        var url = c.getFrontUrl(stack[i]);
        if (counts[url]) {
            counts[url] += 1;
        } else {
            counts[url] = 1;
            cards.push({
                // XXX name should be gotten in another way
                'name': url.split("/").slice(-1)[0].split(".jpg")[0],
                'img_url': url,
            });
        }
    }
    var i_counts = [];
    for (i in cards) {
        i_counts.push(counts[cards[i]['img_url']]);
    }

    this._showDeckPanel(function() {
        s.previewItems(cards, null, true, i_counts);
        that._resizePreview(cards);
        $("#deckpanel").css('left', '-' + $("#deckpanel").outerWidth() + "px");
        $("#search_preview").show();
    }, true);
    if (mine) {
        this.fyi(this.user + " is browsing a stack of " + this.pronoun() + " cards.");
    } else {
        this.fyi(this.user + " is browsing a stack of " + this.pronoun() + " opponent's cards.");
    }
}

KansasUI.prototype._draw = function(memberCard) {
    var txn = this.view.startBulkMove();
    txn.moveToHand(toId(memberCard), this.hand_user);
    txn.commit();
}

KansasUI.prototype._shuffleSelectionConfirm = function() {
    if (this.selectedSet.length < 5) {
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


var seed = 0;
function srandom() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

// Standard Fisher-Yates shuffle
function shuffle(array, set_seed) {
    if (set_seed) {
        seed = 0;
    } else {
        seed = Math.random() * 100000;
    }
    var counter = array.length, temp, index;

    // While there are elements in the array
    while (counter > 0) {
        // Pick a random index
        index = (srandom() * counter--) | 0;

        // And swap the last element with it
        temp = array[counter];
        array[counter] = array[index];
        array[index] = temp;
    }

    return array;
}

/* Shuffles majority if there is one, and puts leftover cards on top. */
KansasUI.prototype._shuffleSelection = function() {
    var that = this;
    var majorityKey = majority(that.selectedSet, function(x) {
        return that.client.getPos($(x))[1];
    });
    var exemplar = this.client.getStackTop('board', majorityKey);
    var orient = -1;  // By default, hides all cards.
    var txn = this.view.startBulkMove();

    // First, flip cards upside down.
    var randomized = [];
    $.each(that.selectedSet, function() {
        var card = $(this);
        txn.setOrient(card, orient);
        randomized.push(this);
    });
    txn.commit();

    // Second, randomize their order. This cannot be done with (1) in the
    // same txn because orientation changes are assumed to be in place.
    txn = this.view.startBulkMove();
    shuffle(randomized);
    $.each(randomized, function() {
        var card = $(this);
        txn.moveOnto(card, exemplar);
    });
    txn.commit();
}

/* Goes from a single card to selecting the entire stack. */
KansasUI.prototype._cardToSelection = function(card) {
    this._createSelection(this._stackOf(card), true);
    return "refreshselection";
}

KansasUI.prototype._flipSelected = function() {
    var txn = this.view.startBulkMove();
    $.each(zSorted(this.selectedSet), function() {
        txn.flip($(this));
    });
    txn.commit();
}

KansasUI.prototype._unflipSelected = function() {
    var txn = this.view.startBulkMove();
    $.each(zSorted(this.selectedSet), function() {
        txn.unflip($(this));
    });
    txn.commit();
}

KansasUI.prototype._rotateSelected = function() {
    var txn = this.view.startBulkMove();
    $.each(zSorted(this.selectedSet), function() {
        txn.rotate($(this));
    });
    txn.commit();
}

KansasUI.prototype._unrotateSelected = function() {
    var txn = this.view.startBulkMove();
    $.each(zSorted(this.selectedSet), function() {
        txn.unrotate($(this));
    });
    txn.commit();
}

/* Shows hovermenu of prev card in stack. */
KansasUI.prototype._stackNext = function(memberCard) {
    var idx = this.client.stackIndex(memberCard) - 1;
    var nextId = this.client.stackOf(memberCard)[idx];
    var next = $("#card_" + nextId);
    this.activeCard = next;
    this._showHoverMenu(next);
    return "keepmenu";
}

/* Shows hovermenu of prev card in stack. */
KansasUI.prototype._stackPrev = function(memberCard) {
    var idx = this.client.stackIndex(memberCard) + 1;
    var prevId = this.client.stackOf(memberCard)[idx];
    var prev = $("#card_" + prevId);
    this.activeCard = prev;
    this._showHoverMenu(prev);
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
        this.hoverCardId = "#selectionbox";
        var newNode = this._menuForSelection(card);
    } else {
        this.hoverCardId = card.prop("id");
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
        newNode.fadeIn('slow');
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
        + '<div class="blueglow" style="height: '
        + height + 'px; width: ' + width + 'px;"'
        + '><span class=blueglowtext>Click to browse selection.</span></div>'
        + '<ul class="hovermenu" style="float: right; width: 50px;">'
        + '<span class="header" style="margin-left: -130px">'
        + '&nbsp;SELECTION</span>"'
        + cardContextMenu
        + '</ul>'
        + '<div class="hovernote"><span class="hoverdesc">'
        + selectedSet.length
        + ' cards selected</span></div>'
        + '</div>');

    var newNode = $(html).appendTo("body");
    var mine = !selectedSet.hasClass("flipped");
    $(".blueglow").on('mouseup', function( ){
        that._browseStack(selectedSet, true);
        that._removeHoverMenu();
        if (mine) {
            that.fyi(that.user + " is browsing a selection of " + that.pronoun() + " cards.");
        } else {
            that.fyi(that.user + " is browsing a selection of " + that.pronoun() + " opponent's cards.");
        }
    });
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
    if (this.client.inHand(selectedSet)) {
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
    this.vlog(2, "Hover menu for #" + this.hoverCardId
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
        var flipFn = '<li style="margin-left: -130px"'
            + ' data-key=flip>Hide</li>';
    } else {
        var flipFn = '<li style="margin-left: -130px"'
            + ' data-key=unflip>Reveal</li>';
    }
    var drawFn = ('<li style="margin-left: -130px"'
        + ' class="boardonly"'
        + ' data-key="draw">Draw</li>');
    var removeFn = ('<li style="margin-left: -130px"'
        + ' class="removeconfirm top"'
        + ' data-key="removeconfirm">Remove</li>');

    var html = ('<div class="hovermenu">'
        + '<img class="' + imgCls + '" style="height: '
        + height + 'px; width: ' + width + 'px;"'
        + ' src="' + src + '"></img>'
        + '<ul class="hovermenu" style="float: right; width: 50px;">');
    if (numCards > 1 && !this.client.inHand(card)) {
        html += '<span class="header" style="margin-left: -130px">&nbsp;STACK</span>"';
        html += ('<li style="margin-left: -130px"'
            + ' class="top boardonly bulk"'
            + ' data-key="browsestack">Browse</li>'
            + '<li style="margin-left: -130px"'
            + ' class="bottom bulk boardonly"'
            + ' data-key="toselection"><i>Select...</i></li>');
        removeFn = "";
        drawFn = ('<li style="margin-left: -130px"'
            + ' class="boardonly top"'
            + ' data-key="draw">Draw</li>');
    }

    var cardContextMenu = (removeFn + drawFn + flipFn + tapFn
        + '<li style="margin-left: -130px"'
        + ' class="bottom peek boardonly" data-key="peek">Peek'
        + '</li>');
    html += ('<span class="header" style="margin-left: -130px">&nbsp;CARD</span>"'
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
    if (this.client.inHand(card)) {
        $(".boardonly").addClass("disabled");
        $(".hovernote").hide();
    } else if (numCards > 1) {
        $(".hovernote").show();
        $(".boardonly").removeClass("disabled");
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
    if (this.client.getOrient(card) > 0) {
        $(".peek").addClass("disabled");
    }
    return newNode;
}

/* Changes the visible orientation the card */
KansasUI.prototype._setOrientProperties = function(card, orient) {
    this.vlog(3, "set orient: " + card.prop("id") + " = " + orient);
    if (orient > 0) {
        card.prop("src", this._toResource(
            isRetina ? this.client.getFrontUrl(card)
                     : this.client.getSmallUrl(card)));
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

    // We only want to override drag behavior on draggable nodes.
    var t = $(event.target);
    if (!t.hasClass("ui-draggable")
            && t.prop("id") != "arena") {
        return false;
    }

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

KansasUI.prototype.pronoun = function() {
    if (this.gender == "male") {
        return "his";
    } else if (this.gender == "female") {
        return "her";
    } else {
        return "his or her";
    }
}

KansasUI.prototype.init = function(client, uuid, user, orient, gameid, gender, user_id) {
    var that = this;
    this.client = client;
    this.gameid = gameid;
    this.uuid = uuid;
    this.user = user;
    this.user_id = user_id;
    this.gender = gender;
    this.oldtitle = document.title;

    if (isMobile.any()) {
        $(".actionbutton").addClass("largeactionbutton");
    }

    function doValidate(inPlace) {
        var html = $("#deckinput").html();
        var cards = extractCards(html)[0];
        that.vlog(2, "validating cards: " + JSON.stringify(cards));
        that._setDeckInputHtml(cardsToHtml(cards, 'maybe_valid'));
        client.callAsync('bulkquery', {
            'terms': $.map(cards, function(x) {
                if (x[0] > 0) {
                    return [[x[0], x[1]]];
                } else {
                    return [];
                }
            }),
        }).then(function(data) {
            var html = $("#deckinput").html();
            var cards = extractCards(html)[0];
            var resp = cardsToHtml(cards, 'validated', data.resp);
            that._setDeckInputHtml(resp);
            var urls = [];
            var counts = [];
            for (i in cards) {
                var url = data.resp[cards[i][1]];
                if (url) {
                    counts[urls.length] = cards[i][0];
                    urls.push(url);
                }
            }
            if (urls.length > 0) {
                that.searcher.previewItems(urls, null, null, counts, undefined, data['suggested']);
                if (!inPlace) {
                    $("#search_preview").scrollTop(0);
                }
            } else {
                $("#search_preview").hide();
            }
        });
    }

    this.searcher = new KansasSearcher(
        this.client,
        "search_preview",
        "notfound",
        "kansas_typeahead",
        function(stream, meta, decks, suggestions) {
            if (deckPanelVisible()) {
                that._resizePreview(stream, decks, suggestions);
                return true;
            } else {
                return false;
            }
        },
        doValidate,
        function(cardbox, name, search_term) {
            function makeSearchButton(name) {
                var searchButton = $('<div title="Web search" class="button3 cardbutton searchbutton">' +
                    '?</div>').appendTo(cardbox);
                searchButton.on("click", function(event) {
                    window.open("http://google.com/search?q=mtg:" + name, '_blank');
                });
                return searchButton;
            }
            if (search_term == true) {
                var searchButton = makeSearchButton(name);
                var moveButton = $("<div title='Move to hand' class='cardbutton movebutton'>↴</div>").appendTo(cardbox);
                moveButton.on("click", function(event) {
                    event.preventDefault();
                    if (that.selectedSet.length > 0) {
                        var stack = [];
                        shuffle(that.selectedSet);
                        that.selectedSet.map(function(i) {
                            var card = $(this);
                            var ans = toId(card);
                            if (!isNaN(ans)) {
                                stack.push(ans);
                            }
                        });
                    } else {
                        var stack = that.client.stackOf(that.browsingCard);
                    }
                    for (i in stack) {
                        var url = that.client.getFrontUrl(stack[i]);
                        var cname = url.split("/").slice(-1)[0].split(".jpg")[0];
                        if (cname == name) {
                            that.view.startBulkMove()
                                .moveToHand(stack[i], that.hand_user)
                                .commit();
                            break;
                        }
                    }
                    that.fyi(that.user + " has moved a card to " + that.pronoun() + " hand.");
                    that._removeFocus();
                    hideDeckPanel();
                });
                var topButton = $("<div title='Move to top of deck' class='cardbutton button2 topbutton'>↻</div>").appendTo(cardbox);
                topButton.on("click", function(event) {
                    event.preventDefault();
                    if (that.selectedSet.length > 0) {
                        var stack = [];
                        that.selectedSet.map(function(i) {
                            var card = $(this);
                            var ans = toId(card);
                            if (!isNaN(ans)) {
                                stack.push(ans);
                            }
                        });
                    } else {
                        var stack = that.client.stackOf(that.browsingCard);
                    }
                    for (i in stack) {
                        var url = that.client.getFrontUrl(stack[i]);
                        var cname = url.split("/").slice(-1)[0].split(".jpg")[0];
                        if (cname == name) {
                            that.view.startBulkMove()
                                .moveOnto(stack[i], that.browsingCard)
                                .commit();
                            break;
                        }
                    }
                    that.fyi(that.user + " has moved a card to the top of its deck.");
                    that._removeFocus();
                    hideDeckPanel();
                });
            } else if (search_term) {
                var found = false;
                var html = $("#deckinput").html();
                var cards = extractCards(html)[0];
                for (i in cards) {
                    if (cards[i][1] == name) {
                        found = true;
                    }
                }
                var searchButton = makeSearchButton(name);
                var getButton = $("<div title='Add to hand' class='button2 cardbutton getbutton'>↴</div>").appendTo(cardbox);
                getButton.on("click", function(event) {
                    event.preventDefault();
                    that.fyi(that.user + " has added a card to " + that.pronoun() + " hand.");
                    client.callAsync('add', {
                        'cards': [{tohand: true, loc: that.hand_user, name: name}],
                        'requestor': that.uuid,
                    });
                });
                var addButton = $("<div title='Add to deck list' class='cardbutton addbutton'>+</div>").appendTo(cardbox);
                if (found) {
                    addButton.addClass("found");
                    addButton.text("✓");
                }
                if (!isMobile.any()) {
                    getButton.hide();
                    searchButton.hide();
                    if (!addButton.hasClass("found")) {
                        addButton.hide();
                    }
                    cardbox.on('mousemove', function() {
                        getButton.fadeIn();
                        addButton.fadeIn();
                        searchButton.fadeIn();
                    });
                    cardbox.on('mouseleave', function() {
                        getButton.fadeOut();
                        searchButton.fadeOut();
                        if (!addButton.hasClass("found")) {
                            addButton.fadeOut();
                        }
                    });
                }
                addButton.on("click", function(event) {
                    event.preventDefault();
                    if (addButton.hasClass("found")) {
                        var html = $("#deckinput").html();
                        var cards = extractCards(html)[0];
                        for (i in cards) {
                            if (cards[i][1] == name) {
                                cards[i][0] = 0;
                                cards[i][1] = null;  // remove card on hitting zero
                            }
                        }
                        that._setDeckInputHtml(cardsToHtml(cards, 'validated', lastVerifiedUrls, true));
                        addButton.removeClass("found");
                        addButton.text("+");
                        return;
                    }
                    var html = $("#deckinput").html();
                    var cards = extractCards(html)[0];
                    cards.push([1, name, ""]);
                    that._setDeckInputHtml(cardsToHtml(cards, 'validated', lastVerifiedUrls, true));
                    addButton.addClass("found");
                    addButton.text("✓");
                });
            } else {
                var searchButton = makeSearchButton(name);
                var addButton = $("<div title='Add 1' class='cardbutton addbutton'>+</div>").appendTo(cardbox);
                var removeButton = $("<div title='Remove 1' class='cardbutton button2 removebutton'>−</div>").appendTo(cardbox);
                removeButton.on("click", function(event) {
                    var html = $("#deckinput").html();
                    var cards = extractCards(html)[0];
                    for (i in cards) {
                        if (cards[i][1] == name) {
                            cards[i][0] -= 1;
                            if (cards[i][0] == 0) {
                                cards[i][1] = null;  // remove card on hitting zero
                            }
                        }
                    }
                    that._setDeckInputHtml(cardsToHtml(cards, 'maybe_valid'));
                    doValidate(true);
                    event.preventDefault();
                });
                addButton.on("click", function(event) {
                    var html = $("#deckinput").html();
                    var cards = extractCards(html)[0];
                    for (i in cards) {
                        if (cards[i][1] == name) {
                            cards[i][0] += 1;
                        }
                    }
                    that._setDeckInputHtml(cardsToHtml(cards, 'maybe_valid'));
                    doValidate(true);
                    event.preventDefault();
                });
            }
            if (isMobile.any()) {
                $(".cardbutton").addClass("largebutton");
            }
        }
    );

    $(window).keypress(function(e) {
        var key = e.which;
        if (deckPanelVisible() || $("#chatbox").is(":focus")) {
            return true;
        }
        if (key == 109 /* 'm' */) {
            $("#chatbox").select().prop("placeholder", "");
            $("#chat-wrapper").slideDown('fast');
            $('#chatbox').focus();
            that._redrawHand();
            return false;
        }
    });

    $("#chatbox").keyup(function (e) {
        if (e.keyCode == 13 /* Enter */) {
            var msg = $("#chatbox").val();
            if (msg) {
                client.send("broadcast",
                    {
                        subtype: "message",
                        uuid: uuid,
                        name: user,
                        msg: msg,
                        include_self: true,
                    });
            }
            $("#chatbox").val("");
        }
    });

    $("#chatbanner").on('click', function (e) {
        if ($('#chat-wrapper').is(':visible')) {
            $('#chat-wrapper').slideUp('fast', that._redrawHand.bind(that));
        } else {
            $('#chat-wrapper').slideDown('fast');
            that._redrawHand();
        }
    });

    $(window).keyup(function(e) {
        var key = e.which;
        if (key == 27 /* Esc */) {
            that._removeFocus();
            if (deckPanelVisible()) {
                hideDeckPanel();
            }
            $("#search_preview").hide();
        }
    });

    $("#kansas_typeahead").keypress(function() {
        that.searcher.handleQueryStringUpdate();
    });

    /* Prevents search form from being submitted normally. */
    $("form").submit(function(event) {
        event.preventDefault();
        return false;
    });

    this.orient = orient;
    if (orient == "player1") {
        this.hand_user = "Player 1";
        this.opposing_hand_user = "Player 2";
        this.view = new KansasView(client, 0, [0, 0], getBBox());
    } else {
        this.hand_user = "Player 2";
        this.opposing_hand_user = "Player 1";
        this.view = new KansasView(
            client, 2, [-kCardWidth, -kCardHeight], getBBox());
    }
    this._setSizes();

    this.eventTable = {
        'flip': this._flipCard,
        'unflip': this._unflipCard,
        'flipall': this._flipSelected,
        'unflipall': this._unflipSelected,
        'rotate': this._rotateCard,
        'unrotate': this._unrotateCard,
        'rotateall': this._rotateSelected,
        'unrotateall': this._unrotateSelected,
        'reversestack': this._reverseStack,
        'browsestack': this._browseStack,
        'draw': this._draw,
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

    if (this.initialized_once) {
        return;
    }
    this.initialized_once = true;

    document.addEventListener("touchstart", touchHandler, true);
    document.addEventListener("touchmove", touchHandler, true);
    document.addEventListener("touchend", touchHandler, true);
    document.addEventListener("touchcancel", touchHandler, true);
    document.addEventListener("touchleave", touchHandler, true);

    $("#deckinput")[0].addEventListener("paste", function(e) {
        // cancel paste
        e.preventDefault();

        // get text representation of clipboard
        var text = e.clipboardData.getData("text/plain");
        text = text.replace(/\r\n/g, '\<br\>');
        text = text.replace(/\n/g, '\<br\>');
        text = text.replace(/^\<br\>/g, '');

        // insert text manually
        document.execCommand("insertHTML", false, text);
    });

    $("#closepanel").mouseup(function() {
        hideDeckPanel();
    });

    $("#validate").click(function(e) {
        doValidate();
    });

    $("#leave").mouseup(function(e) {
        document.location.hash = "";
        document.location.reload();
    });

    $("#cleardeck").mouseup(function(e) {
        if (confirm("Remove all cards from the board?")) {
            that.client.send("remove", that.client.listAll());
        }
        that.fyi(that.user + " has cleared all cards from the board.");
    });

    $("#deck").mouseup(function(e) {
        that._showDeckPanel();
        e.stopPropagation();
    });

    $("#savedeck").mouseup(function(e) {
        var name = $('#deckname').val().replace("\"", "'");
        var res = extractCards($("#deckinput").html());
        var ncards = res[1];
        if (ncards == 0 || !name) {
            return;
        }
        var existing = that.decksAvail;
        for (i in existing) {
            if (name == existing[i]) {
                if (!confirm("Replace existing deck '" + name + "'?")) {
                    return;
                }
            }
        }
        var cards = JSON.stringify(res[0]);
        client.callAsync('kvop', {
            'namespace': 'Decks#' + that.user_id,
            'op': 'Put',
            'key': name,
            'value': cards,
        }).then(function() { that._refreshDeckList(); });
    });

    $("#switchside").live('mouseup', function(e) {
        var orient = that.orient;
        if (orient == "player1") {
            orient = "player2";
        } else {
            orient = "player1";
        }

        document.location.hash = orient + ";" + that.gameid;
        document.location.reload();
    });

    $(".deletedeck").live('mouseup', function(e) {
        var name = $(e.currentTarget).data("name");
        if (confirm("Are you sure you want to delete '" + name + "'?")) {
            client.callAsync('kvop', {
                'namespace': 'Decks#' + that.user_id,
                'op': 'Delete',
                'key': name,
            }).then(function() { that._refreshDeckList(); });
        }
    });

    $(".loaddeck").live('mouseup', function(e) {
        var name = $(e.currentTarget).data("name");
        if (!name) {
            return;
        }
        client.callAsync('kvop', {
            'namespace': 'Decks#' + that.user_id,
            'op': 'Get',
            'key': name,
        }).then(function(data) {
            var cards = JSON.parse(data.resp);
            $("#deckname").val(data.req.key);
            that._setDeckInputHtml(cardsToHtml(cards));
            doValidate();
        });
    });

    $("#add").mouseup(function(e) {
        var cards = extractCards($('#deckinput').html())[0];
        var kAddLimit = 150;
        var toAdd = [];
        if (that.hand_user == "Player 2") {
            var pos = 39059672;
        } else {
            var pos = 72025744;
        }
        var total = 0;
        for (i in cards) {
            var count = cards[i][0];
            total += count;
            if (total > kAddLimit) {
                alert("You cannot add more than 150 cards at once.");
                return;
            }
            for (var j = 0; j < count; j++) {
                toAdd.push({
                    loc: pos,
                    name: cards[i][1],
                });
            }
        }
        shuffle(toAdd);
        var myCards = $.map($(".card").not(".flipped"),
            function(i) { return toId($(i)); });
        if (myCards.length > 0) {
            if (confirm("This will replace all cards on your side of the board.")) {
                client.callAsync('remove', myCards);
            } else {
                return;
            }
        }
        that.fyi(that.user + " has added " + that.pronoun() + " new deck to the board.");
        var f = client.callAsync('add', {'cards': toAdd, 'requestor': uuid});
        hideDeckPanel();
        f.then(function() {
            var oldHand = client.getStack('hands', that.hand_user);
            if (oldHand) {
                client.callAsync('remove', oldHand);
            }
            var stack = client.getStack('board', pos).slice(-7);
            var txn = that.view.startBulkMove();
            for (i in stack) {
                txn.moveToHand(stack[i], that.hand_user);
            }
            txn.commit();
        });
    });

    $("#opposinghand").droppable({
        over: function(event, ui) {
            $("#opposinghand").addClass("active");
        },
        out: function(event, ui) {
            $("#opposinghand").removeClass("active");
        },
        tolerance: "touch",
    });

    $("#hand").droppable({
        over: function(event, ui) {
            if (ui.draggable.hasClass("card")) {
                var card = toId(ui.draggable);
                if (!that.client.inHand(ui.draggable)) {
                    that._redrawHand();
                }
                that._activateHand();
            }
        },
        out: function(event, ui) {
            deactivateHand(true);
            if (that.dragging && !$("#hand").hasClass("collapsed")) {
                $("#hand").addClass("collapsed");
                that._redrawHand();
            }
        },
        tolerance: "touch",
    });

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
                that._showHoverMenu(that.selectedSet);
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
                disallowed = !that.client.inHand(present);
            }
            if (elem.hasClass("card") && disallowed !== that.client.inHand(elem)) {
                elem.addClass("selecting");
            }
        },
        unselecting: function(event, ui) {
            var elem = $(ui.unselecting);
            elem.removeClass("selecting");
        },
    });

    $("#chat").draggable({
        handle: "#chatbanner",
        containment: $("#arena"),
        distance: 50,
    });

    $("#chat").bind("dragstart", function(event, ui) {
        if (!$("#chatbox").is(":visible")) {
            return false;
        }
        $("#chat").css("bottom", "auto");
        $("#chat").css("right", "auto");
        $("#chatbanner").off();
    });

    $("#selectionbox").draggable({
        /* Manual containment is used, since we manually resize the box. */
        distance: 50,
    });

    $("#selectionbox").mouseup(function(event) {
        var box = $("#selectionbox");
        that._updateFocus(box);
        if ($("#opposinghand").hasClass("active")) {
            deferDeactivateHand();
            that._handleSelectionMovedToOpposingHand(that.selectedSet);
        } else if ($("#hand").hasClass("active")) {
            deferDeactivateHand();
            that._handleSelectionMovedToHand(that.selectedSet);
        } else {
            var delta = selectionBoxOffset();
            var x = delta[0];
            var y = delta[1];
            var dx = delta[2];
            var dy = delta[3];
            if (that.client.inHand(that.selectedSet)) {
                if (that.dragging) {
                    that._handleSelectionMovedFromHand(that.selectedSet, x, y);
                } else {
                    that._handleSelectionClicked(that.selectedSet, event);
                }
            } else {
                if (dx == 0 && dy == 0) {
                    that._handleSelectionClicked(that.selectedSet, event);
                } else {
                    that._handleSelectionMoved(that.selectedSet, dx, dy);
                }
            }
        }
    });

    $("#selectionbox").bind("dragstart", function(event, ui) {
        that._removeHoverMenu();
        $("#selectionbox span").css("opacity", 1);
        var box = $("#selectionbox");
        if (that.client.inHand(that.selectedSet)) {
            $("#selectionarea").hide();
            var oldoffset = box.offset();
            box.width(kCardWidth + kSelectionBoxPadding * 2);
            box.height(kCardHeight + kSelectionBoxPadding * 2);
            box.css("margin-left", event.pageX - oldoffset.left - kCardWidth / 1.7);
            box.css("margin-top", event.pageY - oldoffset.top - kCardHeight);
        }
        that._startDragProgress(box);
        that.dragging = true;
    });

    $("#selectionbox").bind("drag", function(event, ui) {
        var box = $("#selectionbox");
        that._updateDragProgress(box);
        // Calculated manually because we sometimes resize the box.
        if (box.offset().top + box.outerHeight() - 3 < $("#hand").offset().top) {
            deactivateHand(true);
        }
        if (box.offset().top + box.outerHeight() > $("#hand").offset().top) {
            that._activateHand();
        }
        if (box.offset().top < 25) {
            $("#opposinghand").addClass("active");
        } else {
            $("#opposinghand").removeClass("active");
        }
    });

    $("#selectionbox").bind("dragstop", function(event, ui) {
        that.dragging = false;
    });

    $("#chatbox").mouseup(function(event) {
        that.disableArenaEvents = true;
    });

    $("#arena").mouseup(function(event) {
        hideDeckPanel();
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
        that.view.resize(getBBox());
        that._redrawHand();
        that._redrawOtherHands();
        that._redrawBoard();
        that._resizePreview(that._previewUrls);
    });

    this._setSizes();
}

KansasUI.prototype._resizePreview = function(urls, decks, suggestions) {
    if (!decks) {
        decks = {};
    }
    if (!urls) {
        urls = this._previewUrls || [];
    } else {
        this._previewUrls = urls;
    }
    var length = urls.length + Object.keys(decks).length;
    if (suggestions && suggestions.length > 0) {
        length += 1;
    }
    var maxw = $("body").outerWidth() * .65 - 50;
    var columns = Math.min(6, length);
    if (length == 1) {
        var width = 250;
    } else {
        var width = 260 * columns;
        while (width > maxw && maxw > 250 && columns > 2) {
            columns -= 1;
            if (isMobile.any()) {
                width = 250 * columns;
            } else {
                width = 260 * columns;
            }
        }
    }
    $("#search_preview").width(width + "px");
}

/* Forces re-render of cards on board. */
KansasUI.prototype._redrawBoard = function() {
    var stacks = this.client.listStacks('board');
    for (i in stacks) {
        this._redrawStack(stacks[i]);
    }
    this._setSizes();
}

/* Sets position of center divider. */
KansasUI.prototype._setSizes = function() {
    $("#divider").fadeIn().css("top", this.view.height / 2);
    if (isMobile.any()) {
        var height = ($("#arena").outerHeight() - 20) + "px";
        $("#deckpanel").height(height);
        $("#search_preview").css("max-height", height);
    }
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
function deactivateHand(keepOpposing) {
    deactivateQueued = false;
    $("#hand").removeClass("active");
    if (!keepOpposing) {
        $("#opposinghand").removeClass("active");
    }
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
        $("#opposinghand").removeClass("active");
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

/* Returns all cards in the same stack as memberCard. */
KansasUI.prototype._stackOf = function(memberCard) {
    var client = this.client;
    var key = client.getPos(memberCard)[1];
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
        if (pos == this.hand_user) {
            this._redrawHand();
        } else {
            this._redrawOtherHands();
        }
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

KansasUI.prototype._redrawOtherHands = function() {
    this.vlog(1, "redrawOtherHands");
    var hands = this.client.listStacks('hands');
    for (i in hands) {
        var user = hands[i];
        if (user != this.hand_user) {
            var kHandSpacing = 3;
            var cardWidth = kCardWidth + 6;
            var handWidth = $("#opposinghand").outerWidth();
            var hand = this.client.getStack('hands', user);
            var collapsedHandSpacing = Math.min(
                kHandSpacing + cardWidth,
                (handWidth - cardWidth - kHandSpacing * 2) / (hand.length - 1)
            );
            var xOffset = $("#opposinghand").offset().left + kHandSpacing;
            var yOffset = -115;
            var baseZIndex = 2300001;
            for (j in hand) {
                var card = $("#card_" + hand[j]);
                card.animate({
                    left: xOffset,
                    top: yOffset,
                    opacity: 1.0,
                }, kAnimationLength / 2);
                if (card.zIndex() <= baseZIndex) {
                    card.zIndex(baseZIndex + 1);
                }
                this._setOrientProperties(card, this._getEffectiveOrient(card));
                updateCardFlipState(card, 0);
                baseZIndex = card.zIndex();
                xOffset += collapsedHandSpacing;
            }
        }
    }
}

/* Forces a re-render of the hand after a handCache update. */
KansasUI.prototype._redrawHand = function() {
    this.vlog(2, "redrawHand");
    var that = this;
    var hand = this.client.getStack('hands', this.hand_user);
    if (!hand) {
        hand = [];
    }

    var kHandSpacing = 4;
    var kConsiderUnloaded = 20;
    var handWidth = $("#hand").outerWidth();
    if ($("#chatbox").is(":visible")) {
        handWidth -= $("#chat").outerWidth();
    }
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

    var skips = 0;
    function onCompleteAnimation(cd) {
        return function() {
            that._setOrientProperties(cd, that.client.getOrient(cd));
        }
    }

    for (i in hand) {
        var cd = $("#card_" + hand[i]);
        updateCardFlipState(cd, 999999);
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
            cd.animate({
                left: currentX,
                top: currentY,
                opacity: 1.0,
            }, kAnimationLength, undefined, onCompleteAnimation(cd));
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

/* Produces a location key from a jquery selection. */
// TODO move into KansasView... somehow? this is hard because
// the code needs to know the heightOf() function and rotation state.
KansasUI.prototype._screenToPos = function(target) {
    return this.view.coordToPos(
        this._normalizedX(target),
        this._normalizedY(target));
}

/* Returns the y-key of the card in the client view. */
KansasUI.prototype._normalizedY = function(target) {
    var offset = target.offset();
    var tp = offset.top;
    if (target.prop("id") != this.draggingId
            && target.hasClass("card")) {
        tp -= heightOf(
            this.client.stackIndex(target),
            this.client.stackHeight(target));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        tp -= parseInt(target.css("margin-top"));
    }
    return tp;
}

KansasUI.prototype._normalizedX = function(target) {
    var offset = target.offset();
    var left = offset.left;
    if (target.prop("id") != this.draggingId
            && target.hasClass("card")) {
      left -= heightOf(
        this.client.stackIndex(target),
        this.client.stackHeight(target));
    }
    // Compensates for rotated targets.
    if (target.hasClass("card")) {
        left -= parseInt(target.css("margin-left"));
    }
    return left;
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
    if (xChanged || yChanged) {
        animationCount += 1;
        card.animate({
            left: newX,
            top: newY,
            opacity: 1.0,
        }, kAnimationLength / 2);
    }
}

KansasUI.prototype._getEffectiveOrient = function(card) {
    var orient = this.client.getOrient(card);
    var pos = this.client.getPos(card);
    if (pos[0] == 'hands' && pos[1] != this.hand_user) {
        return - Math.abs(orient);
    } else {
        return orient;
    }
}

KansasUI.prototype._initCards = function(sel) {
    var that = this;
    var client = this.client;

    sel.draggable({
        containment: $("#arena"),
        refreshPositions: true,
    });

    sel.each(function(index, card) {
        card = $(card);
        that._setOrientProperties(card, that._getEffectiveOrient(card));
    });

    sel.bind("dragstart", function(event, ui) {
        if (that.selectedSet.length > 1) {
            that.vlog(0, "not dragging deepened selection");
            return false;
        }
        clearTimeout(that.deepenSelectionTimeoutId);
        that.deepenSelectionTimeoutId = null;
        that.vlog(3, "dragstart");
        var card = $(event.currentTarget);
        that.dragging = true;
        that.draggingId = card.prop("id");
        $("#hand").addClass("dragging");
        that._removeHoverMenu();
        if (that.client.inHand(card)) {
            that.hasDraggedOffStart = true;
        } else {
            deactivateHand(true);
        }
        that._startDragProgress(card);
    });

    sel.bind("drag", function(event, ui) {
        if (that.selectedSet.length > 1) {
            that.vlog(0, "not dragging deepened selection");
            return false;
        }
        clearTimeout(that.deepenSelectionTimeoutId);
        that.deepenSelectionTimeoutId = null;
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

        if ($("#opposinghand").hasClass("active")) {
            deferDeactivateHand();
            txn.moveToHand(card, that.opposing_hand_user);
            that._setOrientProperties(card, -1);
        } else if ($("#hand").hasClass("active")) {
            deferDeactivateHand();
            txn.moveToHand(card, that.hand_user);
            that._setOrientProperties(card, 1);
        } else {
            var snap = that._findSnapPoint(card);
            if (snap != null) {
                txn.moveOnto(card, snap);
            } else {
                txn.moveToBoard(card, that._screenToPos(card));
            }
        }

        txn.commit();

        that.draggingId = null;
        that.dragStartKey = null;
    });

    function deepenSelection() {
        if (that.activeCard) {
            var stack = zSorted(that._stackOf(that.activeCard));
            that._createSelection(stack.slice(-2), false);
        } else {
            var len = that.selectedSet.length + 1;
            var stack = zSorted(that._stackOf(that.selectedSet));
            if (len > stack.length) {
                return;
            }
            that._createSelection(stack.slice(-len), false);
        }
        that.deepenSelectionTimeoutId = setTimeout(deepenSelection, 500);
    }

    sel.mousedown(function(event) {
        that.vlog(3, "----------");
        var card = $(event.currentTarget);
        that.dragStartKey = that.client.getPos(card)[1];
        that.hasDraggedOffStart = false;
        if (that.client.inHand(card)
                && $("#hand").hasClass("collapsed")) {
            that._removeFocus();
        } else {
            that.activeCard = card;
            that._updateFocus(card, true);
        }
        that.deepenSelectionTimeoutId = setTimeout(deepenSelection, 500);
    });

    sel.mouseup(function(event) {
        var card = $(event.currentTarget);
        var inophand = client.getPos(card)[1] == that.opposing_hand_user;
        if (!that.dragging) {
            if ($(".selecting").length != 0) {
                that.vlog(2, "skipping mouseup when selecting");
            } else if (that.client.getPos(card)[0] == "hands"
                    && $("#hand").hasClass("collapsed")) {
                // Expands hand if a card is clicked while collapsed.
                if (!inophand) {
                    $("#hand").removeClass("collapsed");
                    that._redrawHand();
                    that.vlog(2, "expand hand");
                } else {
                    that.vlog(2, "expand hand denied");
                }
            } else if (that.hoverCardId != card.prop("id")) {
                if (!inophand) {
                    that.vlog(2, "case 3a");
                    // Taps/untaps by middle-click.
                    if (event.which == 2) {
                        that._toggleRotateCard(card);
                        that._removeFocus();
                    } else {
                        that._showHoverMenu(card);
                    }
                } else {
                    that.vlog(2, "case 3b");
                }
            } else {
                that.vlog(2, "case 4");
                if (!that.client.inHand(card)) {
                    that._toggleRotateCard(card);
                }
                that._removeFocus();
            }
        }
        that.disableArenaEvents = true;
        dragging = false;
        clearTimeout(that.deepenSelectionTimeoutId);
        that.deepenSelectionTimeoutId = null;
    });
}

var panelShownOnce = false;
KansasUI.prototype.handleReset = function() {
    this.vlog(3, "Reset all local state.");
    $(".uuid_frame").remove();
    $(".card").remove();
    this.handleAdd({
        'cards': this.client.listAll(),
        'requestor': 'reset',
    });
    if (!panelShownOnce && $(".card").not(".flipped").length == 0) {
        panelShownOnce = true;
        this._showDeckPanel();
    }
}

KansasUI.prototype.handleAdd = function(data) {
    var cards = data.cards;
    var requestor = data.requestor;
    var that = this;
    this.vlog(1, "add cards: " + cards);

    function createImageNode(cid) {
        var url = that.client.getSmallUrl(cid);
        if (that.client.getOrient(cid) < 0) {
            url = that.client.getBackUrl(cid);
        }
        var img = '<img style="z-index: '
            + that.nextBoardZIndex + '; display: none"'
            + ' id="card_' + cid + '"'
            + ' class="card" src="' + that._toResource(url) + '">'
        that.nextBoardZIndex += 1;
        return $(img).appendTo("#arena");
    }

    var stacksChanged = {};
    var handChanged = false;
    for (i in cards) {
        var cid = cards[i];
        var card = createImageNode(cid);
        if (this.client.getPos(cid)[0] == 'board') {
            stacksChanged[this.client.getPos(cid)[1]] = 1;
        } else {
            handChanged = true;
        }
    }
    for (s in stacksChanged) {
        this._redrawStack(s);
    }
    if (handChanged) {
        this._redrawHand();
        this._redrawOtherHands();
    }

    for (i in cards) {
        var card = $("#card_" + cards[i]);
        card.fadeIn('fast');
        this._initCards(card);
    }
}

KansasUI.prototype.handleRemove = function(cards) {
    this.vlog(1, "remove cards: " + cards);
    for (i in cards) {
        var cid = cards[i];
        $("#card_" + cid).remove();
    }
}

KansasUI.prototype.handleStackChanged = function(key) {
    var dest_t = key[0];
    var dest_k = key[1];
    this.vlog(1, "stackChanged @ " + key);
    this._redrawStack(dest_k);
}

KansasUI.prototype._setDeckInputHtml = function(res) {
    var replacement = res[0];
    var count = res[1];
    var errors = res[2];
    if (errors) {
        $("#validstatus").text("Could not find " + errors + " cards.");
    } else {
        $("#validstatus").text("Found " + count + " cards.");
    }
    this.vlog(2, "replacement: " + replacement);
    $('#deckinput').html(replacement);
}

KansasUI.prototype._refreshDeckList = function() {
    var that = this;
    this.vlog(2, 'send refresh deck');
    this.client.callAsync('kvop', {
        'namespace': 'Decks#' + that.user_id,
        'op': 'List',
    }).then(function(data) {
        that.vlog(2, 'showing deck data');
        var html = "<br>Your saved decks:";
        that.decksAvail = data['resp'];
        data['resp'].forEach(function(name) {
            html += "<br> &bull; " + "<span> " + name + "</span>"
                + " <button data-name=\"" + name
                + "\" class='loaddeck'>load</button>"
                + " <button data-name=\"" + name
                + "\" class='deletedeck'>delete</button>";
        });
        $('#decks').html(html);
    });
}

/* http://stackoverflow.com/questions/4535888/jquery-text-and-newlines */
function htmlForTextWithEmbeddedNewlines(text) {
    var htmls = [];
    var lines = text.split(/\n/);
    // The temporary <div/> is to perform HTML entity encoding reliably.
    //
    // document.createElement() is *much* faster than jQuery('<div/>')
    // http://stackoverflow.com/questions/268490/
    //
    // You don't need jQuery but then you need to struggle with browser
    // differences in innerText/textContent yourself
    var tmpDiv = jQuery(document.createElement('div'));
    for (var i = 0 ; i < lines.length ; i++) {
        var html = tmpDiv.text(lines[i]).html()
        if (i == lines.length - 1) {
            html = '<span class="lastmsg">' + html + '</span>';
        }
        htmls.push(html);
    }
    return htmls.join("<br>");
}

KansasUI.prototype.fyi = function(msg) {
    this.client.send("broadcast",
        {
            subtype: "message",
            uuid: 0,
            name: '',
            msg: msg,
            include_self: false,
        });
}

KansasUI.prototype.handleBroadcast = function(data) {
    switch (data.subtype) {
        case "dragstart":
            this._handleDragStartBroadcast(data);
            break;
        case "frameupdate":
            this._handleFrameUpdateBroadcast(data);
            break;
        case "message":
            var name = data.name.split(" ")[0];
            var selfmsg = false;
            if (this.uuid == data.uuid) {
                name = "me";
                selfmsg = true;
            } else {
                if (name) {
                    notifications.notify(name + ' says...');
                } else {
                    notifications.notify('Message...');
                }
            }
            var newtext = name + ': ' + data.msg;
            if (!name) {
                newtext = data.msg;
            }
            this.chatHistory.push(newtext);
            $("#chattext").html(
                htmlForTextWithEmbeddedNewlines(
                    this.chatHistory.join("\n")));
              var elem = document.getElementById('chattext');
              elem.scrollTop = elem.scrollHeight;
            if (selfmsg) {
                $(".lastmsg").removeClass("lastmsg");
            } else if (!$('#chat-wrapper').is(':visible')) {
                $("#chatbanner").fadeIn(100).fadeOut(100).fadeIn(100).fadeIn(100).fadeOut(100).fadeIn(100);
            }
            break;
    }
}

function HTMLEscape(html) {
    return document.createElement('div')
        .appendChild(document.createTextNode(html))
        .parentNode
        .innerHTML
}

KansasUI.prototype.handlePresence = function(data) {
    this.vlog(1, "Presence changed: " + JSON.stringify(data));

    var present = {};
    for (i in data) {
        present[data[i].uuid] = true;
    }

    var myuuid = this.uuid;
    var myorient = this.orient;
    var has_conflict = false;
    $.map(data, function(d) {
        if (d.orient == myorient && d.uuid != myuuid) {
            has_conflict = true;
        }
    });
    var base = "";
    if (has_conflict) {
        base = "<button style='height: 50px; margin-right: 10px; position: relative; top: -17px; ' id=switchside>Switch Side</button>";
    }
    $("#presence").html(base +
        $.map(data, function(d) {
            var color = "green";
            var title = d.name;
            if (d.orient == myorient) {
                color = "yellow";
                title = d.name + " can see your hand.";
            }
            if (d.uuid != myuuid) {
                var res = "<a target=_blank style='border-bottom: 2px solid " +
                    color + "; padding: 0;' href='" +
                    d.profile_url + "'>" +
                    "<img title='" + title +
                    "' style='margin-bottom: -2px; border-radius: 2px; padding: 0;' src='" +
                    d.profile_pic + "'>";
                if (color == "yellow") {
                    res += "<span class=warnuser>!</span>";
                }
                res += "</a>";
                return res;
            }
        }).join(" "));

    /* Removes frames of clients no longer present. */
    $.each($(".uuid_frame"), function(i) {
        var frame = $(this);
        if (!present[frame.prop("id")])
            frame.hide();
    });
}

KansasUI.prototype.showSpinner = function(text) {
    if (text) {
        $("#spintext").text(text);
    } else {
        $("#spintext").text("Working...");
    }
    $("#spinner").fadeIn();
}

KansasUI.prototype.hideSpinner = function() {
    $("#spinner").fadeOut();
    if (this.oldtitle) {
        document.title = this.oldtitle;
    }
}

KansasUI.prototype.warning = function(msg) {
    if (!$("#error").is(":visible")) {
        $("#error span").text(msg);
        $("#error").show();
    }
    document.title = msg;
    console.log("WARNING: " + msg);
}

KansasUI.prototype.clear = function(msg) {
    this.hideSpinner();
    $("#error").hide();
}

KansasUI.prototype.vlog = function(i, msg) {
    if (parseInt(i) <= LOGLEVEL) {
        console.log('[' + i + '] ' + msg);
    }
}

})();  /* end namespace kansasui */
