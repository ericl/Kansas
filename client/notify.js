/* Tab notifications. */

var notifications = {
    active: false,
    oldtitle: '',
    currentmsg: '',
    ctr: 0,
    interval: null,
};

notifications.notify = function(msg) {
    /* TODO change favicon? */
    if (!notifications.active) {
        notifications.active = true;
        notifications.oldtitle = document.title;
        notifications.currentmsg = msg;
        notifications.interval = setInterval(function() {
            if (notifications.ctr % 2 == 0) {
                document.title = notifications.currentmsg;
            } else {
                document.title = notifications.oldtitle;
            }
            notifications.ctr += 1;
        }, 1000);
    } else {
        notifications.currentmsg = msg;
    }
}

window.onfocus = function(event) {
    clearInterval(notifications.interval);
    notifications.active = false;
    notifications.interval = null;
    notifications.currentmsg = notifications.oldtitle;
    var last = $(".lastmsg");
    setTimeout(function() { last.removeClass("lastmsg"); }, 1000);
}
