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
var kMinWaitPeriod = 500;
var kMaxPreviewItems = 20;

KansasSearcher.prototype.handleQueryStringUpdate = function() {
    var that = this;
    var query = $(this.typeahead).val();
    if ($.now() - this.lastGet > kMinWaitPeriod) {
        this.lastGet = $.now();
        this.lastSent = query;
        this.client.ui.vlog(1, "sent immediate query '" + query + "'");
        this.client.callAsync("query", {
            "datasource": that.sourceid,
            "term": query,
            "limit": kMaxPreviewItems,
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
            that.client.ui.vlog(1, "sent delayed query '" + query + "'");
            that.client
                .callAsync("query", {
                    "datasource": that.sourceid,
                    "limit": kMaxPreviewItems,
                    "term": query,
                    "allow_inexact": true})
                .then(function(v) { that.handleQueryResponse(v); });
        }
    }, kMinWaitPeriod);
}

KansasSearcher.prototype.handleQueryResponse = function(data) {
    var that = this;
    this.client.ui.vlog(3, JSON.stringify(data));
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
    var ok = this.preview_callback(stream, meta, decks);
    if (!ok) {
        return;
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
        var deck = $('<div class="cardbox" style="color: white">' +
            '<div style="border: 1px solid white; padding: 5px; height: 96.5%;">' +
            '<i>Try <span class="suggesteddeckname">`' + key + '`</span></i><hr>' +
            '<span style="font-size: small;">' + html +
            '</span></div></div>').appendTo(this.preview_div);
        bind(deck, key, html);
    }
    $.each(stream, function(i) {
        that.client.ui.vlog(2, "append: " + $(this)[0]);
        var url = this['img_url'];
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
                + "px' class=kansas_preview src='" + url + "'>"
                + suffix
            );
            j += 1;
        }
        var cardbox = $(
            '<div class="cardbox">'
            + imgs
            + '</div>').appendTo(that.preview_div);
        that.add_cardbox_callback(cardbox, this['name'], term);
    });
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
        var addition = $('<div class="cardbox" style="color: white">' +
            '<div style="border: 1px solid white; padding: 5px; height: 96.5%;">' +
            'Add these cards?<hr>' +
            '<span style="font-size: small;">' + html +
            '</span></div></div>').appendTo(this.preview_div);
        addition.hover(
            function() { addition.addClass("cardboxhover"); },
            function() { addition.removeClass("cardboxhover"); });
        addition.click(function() {
            $("#deckinput").html($("#deckinput").html() + html);
            addition.unbind("mouseenter mouseleave")
                    .removeClass("cardboxhover")
                    .addClass("cardboxactive");
            that.validate_callback();
        });
    }
    $(this.notfound).hide();
    $(this.preview_div).show();
    if (term) {
        $(this.preview_div).scrollTop(0);
    }
}

})();  /* end namespace searcher */

// vim: et sw=4
