var grid = 50;
var delta = 2;
var ws = null;
var hostname = window.location.hostname || "localhost"
var wsport = 8080
var ctr = 0;
var user = "ekl";
var gameid = "test";
var phantom_dest = 0;
var uuid = "p_" + Math.random().toString().substring(5);

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
		console.append(msg + "\n");
		console.scrollTop(console[0].scrollHeight - console.height());
	}

	function initDrag() {
		$(".card").draggable({stack: ".card"});
		$(".card").bind("dragstart", function(event, ui) {
			var target = $(event.currentTarget);
			var card = target.prop("id");
			ws.send("broadcast", {"subtype": "dragstart", "card": card});
		});
		$(".card").bind("drag", function(event, ui) {
			var target = $(event.currentTarget);
			var offset = target.offset();
			var dest_x = parseInt((offset.left + grid/2) / grid) * grid;
			var dest_y = parseInt((offset.top + grid/2) / grid) * grid;
			var dest_key = dest_x | dest_y << 16;
			if (dest_key != phantom_dest) {
				phantom_dest = dest_key;
				var phantom = $("#phantom");
				phantom.width(target.width());
				phantom.height(target.height());
				phantom.css("left", dest_x);
				phantom.css("top", dest_y);
				phantom.show();
				ws.send("broadcast",
					{
						"subtype": "phantomupdate",
						"hide": false,
						"uuid": uuid,
						"name": user,
						"left": dest_x,
						"top": dest_y,
						"width": target.width(),
						"height": target.height()
					});
			}
		});
		$(".card").bind("dragstop", function(event, ui) {
			$("#phantom").fadeOut();
			ws.send("broadcast",
				{
					"subtype": "phantomupdate",
					"hide": true,
					"uuid": uuid,
				});
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
	}

	function reset(state) {
		$(".card").remove();
		for (pos in state.board) {
			var stack = state.board[pos];
			for (z in stack) {
				var cid = stack[z];
				var x = (pos & 0xffff) * grid;
				var y = (pos >> 16) * grid;
				var img = '<img style="z-index: ' + state.zIndex[cid]
					+ '; left: ' + (x + (z * delta)) + 'px'
					+ '; top: ' + (y + (z * delta)) + 'px'
					+ '" id="card_' + cid +
					'" class="card" src="' + state.urls[cid] + '">'
				$("#arena").append(img);
			}
		}
		initDrag();
	}

    ws = $.websocket("ws:///" + hostname + ":" + wsport + "/kansas", {
        open: function() { alert("open"); },
        close: function() { alert("close"); },
        events: {
            connect_resp: function(e) {
                log("Connected: " + e.data);
				$("#connect").hide();
				$(".connected").show();
				reset(e.data[0]);
            },
			resync_resp: function(e) {
				reset(e.data[0]);
			},
			broadcast_resp: function(e) {
				log("broadcast ack: " + e.data);
			},
            error: function(e) {
                log("Error: " + e.msg);
            },
            update: function(e) {
                log("Update: " + JSON.stringify(e.data));
				var lz = e.data.z_stack.length - 1;
				var x = (e.data.move.dest_key & 0xffff) * grid;
				var y = (e.data.move.dest_key >> 16) * grid;
				for (i in e.data.z_stack) {
					if (i == e.data.z_stack.length - 1) {
						continue; // allow the last element to animate
					}
					$("#card_" + e.data.z_stack[i]).css("left", x + i * delta);
					$("#card_" + e.data.z_stack[i]).css("top", y + i * delta);
				}
                $("#card_" + e.data.move.card).css("opacity", "1.0");
                $("#card_" + e.data.move.card).css("z-index", e.data.z_index);
                $("#card_" + e.data.move.card).animate({
					left: x + lz * delta,
					top: y + lz * delta,
				}, 'fast');
            },
			broadcast_message: function(e) {
				switch (e.data.subtype) {
					case "dragstart":
						$("#" + e.data.card).css("opacity", "0.7");
						break;
					case "phantomupdate":
						var phantom = $("#" + e.data.uuid);
						if (phantom.length == 0) {
							phantom = '<div id="' + e.data.uuid + '" style="position: absolute; border: 3px solid orange; pointer-events: none; border-radius: 5px; z-index: 999999; font-size: small;"><span style="background-color: orange; padding-right: 2px; padding-bottom: 2px; border-radius: 2px; color: white; margin-top: -2px !important; margin-left: -1px;">' + e.data.name + '</span></div>';
							$("#arena").append(phantom);
							phantom = $(phantom);
						}
						if (e.data.hide) {
							phantom.fadeOut();
						} else {
							phantom.width(e.data.width - 6);
							phantom.height(e.data.height - 6);
							phantom.css("left", e.data.left);
							phantom.css("top", e.data.top);
							phantom.show();
						}
						break;
				}
                log("Broadcast: " + JSON.stringify(e));
			},
            _default: function(e) {
                log("Unknown response: " + JSON.stringify(e));
            },
        },
    });

	function requireConnect() {
		if (!connected) {
			ws.send("connect", {user: user, gameid: gameid});
			connected = true;
		}
	}

    $("#connect").click(function(e) {
		requireConnect();
    });

    $("#sync").click(function(e) {
        ws.send("resync");
    });
	setTimeout(requireConnect, 1000);
});

// vim: noet ts=4
