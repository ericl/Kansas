// KansasClient - talks to server and provides change notifications
// KansasView - translates screen coordinates into server-side positions

/**
 * Kansas websocket client.
 *
 * Usage:
 *
 *  var kclient = KansasClient(hostname, ip_port)
 *      .bind('stackchanged', ...)
 *      .bind('disconnected', ...)
 *      ...
 *      .connect();
 *
 *  to send a message:
 *      kclient.send(msg_type, msg_payload);
 *
 *  to reconnect:
 *      kclient.connect();
 *
 *  See kclient._hooks for more information on adding hooks.
 *
 *  to query game state:
 *      TODO impl game state accessors:
 *      kclient.get_ids()
 *      kclient.get_serverpos(id)
 *      kclient.get_stack(serverpos)
 *      kclient.front_url(id)
 *      kclient.back_url(id)
 *
 *  to mutate game state:
 *      TODO impl game state mutators:
 *      kclient.startBulkMove()
 *          .move(id1, serverpos_a, server_orient_a)
 *          .move(id2, serverpos_a, server_orient_b)
 *          .move(id3, serverpos_b, server_orient_c)
 *          .commit()
 */
function KansasClient(hostname, ip_port) {
    var client = new Object();

    client._gameState = {
        board: {},
        hands: {},
        urls: {},
        back_urls: {},
    };
    client._ws = null;
    client._state = 'offline';

    client._onOpen = function() {
        console.log("ws:open");
        client._state = 'opened';
    };

    client._onClose = function() {
        console.log("ws:close");
        client._state = 'offline'
        client._ws = null;
        client._notify('disconnected');
    }

    client._reset = function(state) {
        /* TODO reset local cache using state */
        client._notify('reset');
    }

    client._eventHandlers = {
        _default: function(e) {
            console.log("Unhandled response: " + JSON.stringify(e));
        },
        broadcast_resp: function() {
            /* Ignore */
        },
        error: function(e) {
            client._notify('error', e.data);
        },
        broadcast_message: function(e) {
            client._notify('broadcast', e.data);
        },
        list_games_resp: function(e) {
            client._notify('listgames', e.data);
        },
        connect_resp: function(e) {
            client._state = 'connected';
            client._reset(e.data[0]);
        },
        resync_resp: function(e) {
            client._reset(e.data[0]);
        },
        reset: function(e) {
            client._reset(e.data[0]);
        },
        stackupdate: function(e) {
            /* TODO update local cache */
            client._notify('stackchanged', e.data.op.dest_key);
        },
        bulkupdate: function(e) {
            /* TODO update local cache */
            /* TODO call hooks on all changed stacks */
        },
        presence: function(e) {
            client._notify('presence', e.data);
        },
    }

    client._notify = function(hook, arg) {
        console.log('invoke hook: ' + hook);
        client._hooks[hook](arg);
    }

    client._hooks = {
        error: function(data) {},
        broadcast: function(data) {},
        listgames: function(data) {},
        stackchanged: function(data) {},
        reset: function() {},
        disconnected: function() {},
    }

    client.bind = function(name, fn) {
        client._hooks[name] = fn
        return client;
    }

    client.send = function(tag, data) {
        client._ws.send(tag, data);
    }

    client.connect = function(onOpen) {
        client._state = 'offline';
        client._ws = $.websocket(
            "ws:///" + hostname + ":" + ip_port + "/kansas",
            { open: client._onOpen,
              close: client._onClose,
              events: client._eventHandlers});
        return client;
    }

    return client;
}

/**
 * KansasView wraps kclient to provide different user perspectives.
 * E.g. two people looking at a board from different angles.
 *
 * Usage:
 *      var view = KansasView(kclient, 2, [0, 0]);
 *      kclient.get_coord(id)
 *      kclient.front_url(id)
 *      kclient.back_url(id)
 *
 *  to mutate game state:
 *      view.startBulkMove()
 *          .move(id1, x1, y1)
 *          .moveTo(id2, id1)
 *          .move(id3, x2, y2)
 *          .flip(id4)
 *          .unflip(id5)
 *          .rotate(id6)
 *          .unrotate(id7)
 *          .commit()
 */
function KansasView(kclient, rotation, translation) {
    var view = new Object();

    /* TODO define methods on view. */

    return view;
}
