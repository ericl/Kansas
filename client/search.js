/* Provides instant search service. */

// TODO namespace these variables.
var kWSPort = 8080
var hostname = window.location.hostname || "localhost"
var uuid = "p_" + Math.random().toString().substring(5);
var ws = null;
var connected = false;
var disconnected = false;
var lastGet = 0;
var lastTyped = 0;
var tmp;

// TODO detect mobile devices better
var onMobile = navigator.platform.indexOf("android") >= 0;

// The time to wait between queries, in milliseconds.
var kMinWaitPeriod = 350
var requestsInFlight = 0;

function showThrobber() {
    $("#throbber").show();
    $("#notfound").hide();
}

function hideThrobber() {
    requestsInFlight -= 1;
    if (requestsInFlight <= 0) {
        $("#throbber").hide();
    }
}

function log(msg) {
    console.log("[search] " + msg);
}

$(document).ready(function() {
    $("#kansas_typeahead").focus();
    $("form").submit(function(event) {
        event.preventDefault();
        return false;
    });

    $("#kansas_typeahead").keypress(function(event) {
        showThrobber();
        var query = $("#kansas_typeahead").val();
        if ($.now() - lastGet > kMinWaitPeriod) {
            lastGet = $.now();
            requestsInFlight += 1;
            log("sent immediate query " + query);
            ws.send("query", {"term": query, "tags": "immediate"});
        }
        lastTyped = $.now();
        var timestamp = lastTyped;
        setTimeout(function() {
            if (lastTyped == timestamp) {
                lastGet = $.now();
                requestsInFlight += 1;
                query = $("#kansas_typeahead").val();
                log("sent delayed query " + query);
                ws.send("query", {"term": query});
            }
        }, kMinWaitPeriod);
    });

    ws = $.websocket("ws:///" + hostname + ":" + kWSPort + "/kansas", {
        open: function() {
            ws.send("connect_searchapi");
        },
        close: function() {
            log("Connection Error.");
            disconnected = true;
            connected = false;
        },
        events: {
            connect_searchapi_resp: function(e) {
                connected = true;
                log("Connected: " + e.data);
            },
            query_resp: function(e) {
                hideThrobber();
                log(JSON.stringify(e));
                if (e.data.urls === undefined) {
                    if (e.data.tags != "immediate") {
                        $("#notfound").show();
                    }
                } else {
                    $("#previews img").remove();
                    $.each(e.data.urls, function() {
                        $("#previews").append(
                            "<img src="
                            + $(this)[0]
                            + " class=kansas_preview></img>");
                    });
                    $("#notfound").hide();
                }
            },
            _default: function(e) {
                log("Unknown response: " + JSON.stringify(e));
            },
        },
    });
    
    // Put card from preview to hand
    $(".kansas_preview").live("click", function(event) {
        var src_image = $(event.target).prop("src");   
        console.log(src_image);
        $('#hand').prepend('<img src=' + src_image + ' class="own_hand"/>');
    });
    
    // Remove card from hand
    $(".own_hand").live("click", function(event) {
    	$(event.target).remove();
    });
    
    //Function for the buttons
    $("#reset").mouseup(function(e) {
    	$(".own_hand").remove();
    });
    
    $("#player1").mouseup(function(e) {
    	var all_cards = new Array();
    	$(".own_hand").each(function() { 
    		all_cards.push($(this).prop("src")); }
    	);
    	log("sent cards in hand to replace deck at play");
        ws.send("submit", {"player": 1, "cards": all_cards});
    });
    
    $("#player2").mouseup(function(e) {
    });
    
});

//vim:et sw=4
