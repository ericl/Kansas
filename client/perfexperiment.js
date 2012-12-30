var originalHide = jQuery.fn.hide;
jQuery.fn.hide = function() {
    if (this.hasClass("accelerated")) {
        this.data("_left", this.css("left"));
        this.data("_width", this.width());
        this.css("left", -1000);
        this.width(0);
        return this;
    } else {
        return originalHide.apply(this, arguments)
    }
};

var originalShow = jQuery.fn.show;
jQuery.fn.show = function() {
    if (this.hasClass("accelerated")) {
        this.css("left", this.data("_left"));
        this.width(this.data("_width"));
        return this;
    } else {
        return originalShow.apply(this, arguments)
    }
};


var originalZIndex = jQuery.fn.zIndex;
jQuery.fn.zIndex = function() {
    if (this.hasClass("accelerated")) {
        log("NOTIMPLEMENTED: fast z-index changes");
        return this;
    } else {
        return originalZIndex.apply(this, arguments);
    }
};

$(document).ready(function() {
    redrawDivider();
    $("#card_117").addClass("accelerated");
    var ctr = 0;
    setInterval(function() {
        ctr += 1;
        if (ctr % 2 == 0) {
            $("#card_117").hide();
        } else {
            $("#card_117").show();
        }
    }, 200);
});
