/* Provides instant search service. */

function KansasSearcher(client, preview_div_id, notfound_id, typeahead_id) {
    this.client = client;
    this.lastGet = 0;
    this.lastTyped = 0;
    this.preview_div = "#" + preview_div_id;
    this.notfound = "#" + notfound_id;
    this.typeahead = "#" + typeahead_id;
}

(function() {  /* begin namespace searcher */

// The time to wait between queries, in milliseconds.
var kMinWaitPeriod = 500

KansasSearcher.prototype.handleQueryStringUpdate = function() {
    var that = this;
    var query = $(this.typeahead).val();
    if ($.now() - this.lastGet > kMinWaitPeriod) {
        this.lastGet = $.now();
        this.client.ui.vlog(1, "sent immediate query '" + query + "'");
        this.client.callAsync("query", {
            "term": query,
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
            that.client.ui.vlog(1, "sent delayed query '" + query + "'");
            that.client
                .callAsync("query", {"term": query, "allow_inexact": true})
                .then(function(v) { that.handleQueryResponse(v); });
        }
    }, kMinWaitPeriod);
}

KansasSearcher.prototype.handleQueryResponse = function(data) {
    var that = this;
    this.client.ui.vlog(3, JSON.stringify(data));
    if (data.urls.length == 0) {
        if (data.req.term == "") {
            $(this.preview_div + " img").remove();
            $(this.preview_div).hide();
            $(this.notfound).hide();
        } else if (data.req.tags != "immediate") {
            $(this.notfound).show();
            $("#has_more").hide();
        }
    } else {
        console.log(data);
        this.previewItems(data.urls, data.has_more, data.req.term);
    }
}

KansasSearcher.prototype.previewItems = function(urls, has_more, term, counts) {
    var that = this;
    $(this.preview_div).children().remove();
    $.each(urls, function(i) {
        that.client.ui.vlog(2, "append: " + $(this)[0]);
        var url = $(this)[0];
        var count = (counts || {})[i] || 1;
        var imgs = "";
        var j = 0;
        var cardGap = 8;
        var minCardWidth = 180;
        var width = 240 - cardGap * (count - 1);
        if (width < minCardWidth) {
            width = minCardWidth;
            cardGap = (240 - minCardWidth) / count;
        }
        while (j < count) {
            imgs += (
                "<img style='left: "
                + parseInt(j * cardGap)
                + "px; top: "
                + parseInt(j * cardGap / 0.7011)
                + "px; width: "
                + width
                + "px' class=kansas_preview src='" + url + "'>"
            );
            j += 1;
        }
        $(that.preview_div).append(
            '<div class="cardbox">'
            + imgs
            + '</div>');
    });
    if (has_more) {
        $("#has_more")
            .prop("href", "http://magiccards.info/query?q=" + term)
            .show();
    } else {
        $("#has_more").hide();
    }
    $(this.notfound).hide();
    $(this.preview_div).show().scrollTop();
}

})();  /* end namespace searcher */

// vim: et sw=4
