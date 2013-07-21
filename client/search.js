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
    var query = $(this.typeahead).val();
    if ($.now() - this.lastGet > kMinWaitPeriod) {
        this.lastGet = $.now();
        this.client.ui.vlog(1, "sent immediate query " + query);
        this.client.send("query", {
            "term": query,
            "tags": "immediate",
            "allow_inexact": true
        });
    }
    var timestamp = this.lastTyped = $.now();
    var that = this;
    setTimeout(function() {
        if (that.lastTyped == timestamp) {
            that.lastGet = $.now();
            query = $(that.typeahead).val();
            that.client.ui.vlog(1, "sent delayed query " + query);
            that.client.send("query", {"term": query, "allow_inexact": true});
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
        }
    } else {
        this.previewItems(data.urls);
    }
}

KansasSearcher.prototype.previewItems = function(urls) {
    var that = this;
    $(this.preview_div + " img").remove();
    $.each(urls, function() {
        that.client.ui.vlog(1, "append: " + $(this)[0]);
        $(that.preview_div).append(
            "<img src="
            + $(this)[0]
            + " class=kansas_preview></img>");
    });
    $(this.notfound).hide();
    $(this.preview_div).show().scrollTop();
}

})();  /* end namespace searcher */

// vim: et sw=4
