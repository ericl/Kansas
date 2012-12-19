var grid = 100;
var delta = 2;
var ws = null;
$(document).ready(function() {
    ws = $.websocket("ws:///localhost:8080/kansas", {
        open: function() { alert("open"); },
        close: function() { alert("close"); },
        events: {
            connect_resp: function(e) {
                $("#console").append("Connected: " + e.data + "\n");
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
				var z = e.data.z_stack.length - 1;
				var x = (e.data.move.dest_key & 0xffff) * grid;
				var y = (e.data.move.dest_key >> 16) * grid;
				for (i in e.data.z_stack) {
					if (i == e.data.z_stack.length - 1) {
						continue; // allow the last element to animate
					}
					$("#card_" + e.data.z_stack[i]).css("z-index", i);
					$("#card_" + e.data.z_stack[i]).css("left", x + i * delta);
					$("#card_" + e.data.z_stack[i]).css("top", y + i * delta);
				}
                $("#card_" + e.data.move.card).animate({
					left: x + z * delta,
					top: y + z * 2,
					zIndex: z,
				});
            },
            _default: function(e) {
                $("#console").append("Unknown response: " + JSON.stringify(e) + "\n");
            },
        },
    });

    $("#connect").click(function(e) {
        ws.send("connect", {user: "ekl", gameid: "test"});
    });

    $("#sync").click(function(e) {
        ws.send("resync");
    });

	$(".card").draggable({stack: ".card"});
	$(".card").bind("dragstop", function(event, ui) {
		var target = $(event.currentTarget);
		var offset = target.offset();
		var card = parseInt(target.prop("id").substr(5));
		var dest_key = ((offset.left + grid/2) / grid) |
		               ((offset.top + grid/2) / grid) << 16;
        ws.send("move", {move: {card: card,
                                dest_type: "board",
                                dest_key: dest_key,
                                dest_orient: 0}});
	});
});

// vim: noet ts=4
