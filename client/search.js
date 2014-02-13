/* Provides instant search service. */

function KansasSearcher(client, preview_div_id, notfound_id, typeahead_id,
                        preview_cb, validate_cb, add_cardbox_callback) {
    this.client = client;
    this.lastGet = 0;
    this.lastTyped = 0;
    this.lastSent = "";
    this.preview_div = "#" + preview_div_id;
    this.notfound = "#" + notfound_id;
    this.typeahead = "#" + typeahead_id;
    this.preview_callback = preview_cb;
    this.validate_callback = validate_cb;
    this.add_cardbox_callback = add_cardbox_callback;
    this.sourceid = client.sourceid;
}

(function() {  /* begin namespace searcher */

// The time to wait between queries, in milliseconds.
var kMinWaitPeriod = 250;
var kVisiblePreviewItems = 20;
var kLoadPreviewItems = 120;

KansasSearcher.prototype.handleQueryStringUpdate = function() {
    var that = this;
    var query = $(this.typeahead).val();
    if ($.now() - this.lastGet > kMinWaitPeriod) {
        this.lastGet = $.now();
        this.lastSent = query;
        this.client.ui.vlog(2, "sent immediate query '" + query + "'");
        this.client.callAsync("query", {
            "datasource": that.sourceid,
            "term": query,
            "limit": kLoadPreviewItems,
            "tags": "immediate",
            "allow_inexact": true
        }).then(function(v) { that.handleQueryResponse(v); });
    }
    var timestamp = this.lastTyped = $.now();
    var that = this;
    setTimeout(function() {
        if (that.lastTyped == timestamp) {
            that.lastGet = $.now();
            query = $(that.typeahead).val();
            if (query == that.lastSent) {
                return;
            }
            that.lastSent = query;
            that.client.ui.vlog(2, "sent delayed query '" + query + "'");
            that.client
                .callAsync("query", {
                    "datasource": that.sourceid,
                    "limit": kLoadPreviewItems,
                    "term": query,
                    "allow_inexact": true})
                .then(function(v) { that.handleQueryResponse(v); });
        }
    }, kMinWaitPeriod);
}

KansasSearcher.prototype.handleQueryResponse = function(data) {
    var that = this;
    this.client.ui.vlog(3, JSON.stringify(data));
    console.log(data.req.term);
    if (data.req.term.replace(/\W/g, '') != $(this.typeahead).val().replace(/\W/g, '')) {
        console.log("dropped");
        return;  // drop all old data responses
    }
    this.previewItems(data.stream, data.meta, data.req.term,
                      null, data.deck_suggestions);
    if (data.stream.length == 0) {
        if (data.req.term == "") {
            $(this.preview_div + " img").remove();
            $(this.preview_div).hide();
            $(this.notfound).hide();
        } else if (data.req.tags != "immediate") {
            $(this.notfound).show();
            $("#has_more").hide();
        }
    }
}

KansasSearcher.prototype.previewItems = function(stream, meta, term, counts, decks, suggested) {
    if (term !== true) {
        var ok = this.preview_callback(stream, meta, decks, suggested);
        if (!ok) {
            return;
        }
    }
    var that = this;
    $(this.preview_div).children().remove();
    function bind(deck, key, html) {
        deck.hover(
            function() { deck.addClass("cardboxhover"); },
            function() { deck.removeClass("cardboxhover"); });
        deck.click(function() {
            var contents = "== `" + key + "` ==<br><br>" + html;
            $("#deckinput").html(contents);
            deck.unbind("mouseenter mouseleave")
                .removeClass("cardboxhover")
                .addClass("cardboxactive");
            that.validate_callback();
            $("#deckname").val(key);
        });
    }
    for (key in decks) {
        var html = "";
        for (i in decks[key]) {
            html += decks[key][i] + "<br>";
        }
        var deck = this._appendCardBox(
            '<i>Try <span class="suggesteddeckname">`' + key + '`</span></i>', html);
        bind(deck, key, html);
    }
    function addCard(card, i) {
        that.client.ui.vlog(2, "append: " + $(card)[0]);
        var url = card['img_url'];
        var count = (counts || {})[i] || 1;
        if (count > 30) {
            count = 30;
        }
        var imgs = "";
        var j = 0;
        var cardGap = 8;
        var minCardWidth = 180;
        if (count > 20) {
            minCardWidth = 210;
        }
        var width = 240 - cardGap * (count - 1);
        if (width < minCardWidth) {
            width = minCardWidth;
            cardGap = (240 - minCardWidth) / count;
        }
        var prefix = "";
        var suffix = "";
        while (j < count) {
            imgs += (
                prefix
                + "<img style='left: "
                + parseInt(5 + j * cardGap)
                + "px; top: "
                + parseInt(5 + j * cardGap / 0.7011)
                + "px; width: "
                + width
                + "px' class=kansas_preview src=\"" + url + "\">"
                + suffix
            );
            j += 1;
        }
        var cardbox = $(
            '<div class="cardbox">'
            + imgs
            + '</div>').appendTo(that.preview_div);
        that.add_cardbox_callback(cardbox, card['name'], term);
    }
    var numToShow = kVisiblePreviewItems;
    if (!term || term === true) {
        numToShow = 100000;
    }
    $.each(stream.slice(0, numToShow), function(i) {
        addCard(this, i);
    });
    var remainder = stream.slice(numToShow);
    if (meta && meta.has_more) {
        $("#has_more")
            .prop("href", meta.more_url)
            .show();
    } else {
        $("#has_more").hide();
    }
    if (suggested && suggested.length > 0) {
        var html = "";
        for (i in suggested) {
            html += suggested[i] + "<br>";
        }
        var addition = this._appendCardBox("Add these cards?", html);
        addition.hover(
            function() { addition.addClass("cardboxhover"); },
            function() { addition.removeClass("cardboxhover"); });
        addition.click(function() {
            $("#deckinput").html($("#deckinput").html() + html);
            addition.unbind("mouseenter mouseleave")
                    .removeClass("cardboxhover")
                    .addClass("cardboxactive");
            that.validate_callback(true);
        });
    }
    if (remainder.length > 0) {
        var html = "";
        for (i in remainder) {
            if (html != "") {
                html += " ○ ";
            }
            html += remainder[i]['name'];
        }
        if (remainder.length == 100) {
            var addition = this._appendCardBox("Next 100 results for '" + term + "'", html);
        } else {
            var addition = this._appendCardBox("" + remainder.length + " more results for '" + term + "'", html);
        }
        addition.hover(
            function() { addition.addClass("cardboxhover"); },
            function() { addition.removeClass("cardboxhover"); });
        addition.click(function() {
            addition.remove();
            $.each(remainder, function(i) {
                addCard(this, i);
            });
        });
    }
    $(this.notfound).hide();
    $(this.preview_div).show();
    if (term) {
        $(this.preview_div).scrollTop(0);
    }
}

KansasSearcher.prototype._appendCardBox = function(title, contents) {
    return $('<div class="cardbox" style="color: white">' +
             '<div style="border: 1px solid white; padding: 5px; height: 96.5%;">' +
             '<div class=deckheader>' + title + '</div><hr>' + '<div class="deckcontent">' + contents +
             '</div></div></div>').appendTo(this.preview_div);
}

})();  /* end namespace searcher */

// vim: et sw=4
