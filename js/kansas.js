var grid = 250;
var delta = 5;
var ws = null;

// http://stackoverflow.com/questions/5186441/javascript-drag-and-drop-for-touch-devices
function touchHandler(event) {
    var touches = event.changedTouches,
    first = touches[0],
    type = "";

    switch(event.type) {
		case "touchstart": type = "mousedown"; break;
		case "touchmove": type="mousemove"; break;
		case "touchend": type="mouseup"; break;
		default: return;
	}

	var simulatedEvent = document.createEvent("MouseEvent");
	simulatedEvent.initMouseEvent(type, true, true, window, 1,
							      first.screenX, first.screenY,
							      first.clientX, first.clientY, false,
							      false, false, false, 0/*left*/, null);

	first.target.dispatchEvent(simulatedEvent);
	event.preventDefault();
}

function init() {
   document.addEventListener("touchstart", touchHandler, true);
   document.addEventListener("touchmove", touchHandler, true);
   document.addEventListener("touchend", touchHandler, true);
   document.addEventListener("touchcancel", touchHandler, true);
}

$(document).ready(function() {
	init();
	var connected = false;

	function log(msg) {
		var console = $('#console');
		console.append(msg);
		console.scrollTop(console[0].scrollHeight - console.height());
	}

    ws = $.websocket("ws:///" + window.location.hostname + ":8080/kansas", {
        open: function() { alert("open"); },
        close: function() { alert("close"); },
        events: {
            connect_resp: function(e) {
                log("Connected: " + e.data + "\n");
				$("#connect").hide();
				$(".connected").show();
            },
            error: function(e) {
                log("Error: " + e.msg + "\n");
            },
            update: function(e) {
                log("Update: " + JSON.stringify(e.data) + "\n");
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
                $("#card_" + e.data.move.card).css("opacity", "1.0");
                $("#card_" + e.data.move.card).css("z-index", z + 1000);
                $("#card_" + e.data.move.card).animate({
					left: x + z * delta,
					top: y + z * delta,
				});
            },
			broadcast_message: function(e) {
				switch (e.data.subtype) {
					case "dragstart":
						$("#" + e.data.card).css("opacity", "0.7");
						break;
				}
                log("Broadcast: " + JSON.stringify(e) + "\n");
			},
            _default: function(e) {
                log("Unknown response: " + JSON.stringify(e) + "\n");
            },
        },
    });

	function requireConnect() {
		if (!connected) {
			ws.send("connect", {user: "ekl", gameid: "test"});
			connected = true;
		}
	}

    $("#connect").click(function(e) {
		requireConnect();
    });

    $("#sync").click(function(e) {
        ws.send("resync");
    });

	$(".card").draggable({stack: ".card"});
	$(".card").bind("dragstart", function(event, ui) {
		requireConnect();
		var target = $(event.currentTarget);
		var card = target.prop("id");
        ws.send("broadcast", {"subtype": "dragstart", "card": card});
	});
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
