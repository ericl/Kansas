var ws = null;
$(document).ready(function() {
    ws = $.websocket("ws:///localhost:8080/kansas", {
        open: function() { alert("open"); },
        close: function() { alert("close"); },
        events: {
            connect_resp: function(e) {
                $("#console").append("Connected: " + JSON.stringify(e.data) + "\n");
				$("#connect").hide();
				$(".connected").show();
            },
            error: function(e) {
                $("#console").append("Error: " + e.msg + "\n");
            },
            move_resp: function(e) {
                $("#console").append("Now at seqno " + e.data + "\n");
            },
            update: function(e) {
                $("#console").append("Update: " + JSON.stringify(e.data) + "\n");
                $("#card" + e.data.move.card).animate({left: e.data.move.dest_key * 100});
            },
            _default: function(e) {
                $("#console").append("Unknown response: " + JSON.stringify(e) + "\n");
            },
        },
    });

    $("#connect").click(function(e) {
        ws.send("connect", {user: "ekl", gameid: "test"});
    });

    $("#move").click(function(e) {
        $("#card6").animate({left: 5 * 100});
        ws.send("move", {move: {card: 6,
                                dest_type: "board",
                                dest_key: 5,
                                dest_orient: 2}});
    });

    $("#sync").click(function(e) {
        ws.send("resync");
    });
});

// vim: noet ts=4
