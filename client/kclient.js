/**
 * Kansas websocket client - talks to server and notifies of updates.
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
 *      kclient.get_ids() -> list[int]
 *      kclient.get_serverpos(id) -> (type: str, pos)
 *      kclient.get_stack(pos_type, serverpos) -> list[int]
 *      kclient.get_front_url(id) -> str
 *      kclient.get_back_url(id) -> str
 *
 *  to mutate game state:
 *      kclient.newBulkMoveTxn()
 *          .update(id1, dest_t_a, serverpos_a, server_orient_a)
 *          .update(id2, dest_t_a, serverpos_a, server_orient_b)
 *          .update(id3, dest_t_b, serverpos_b, server_orient_c)
 *          .commit()
 */
function KansasClient(hostname, ip_port) {
    this.hostname = hostname;
    this.ip_port = ip_port;
    this._ws = null;
    this._state = 'offline';
    this._gameState = {
        board: {},
        hands: {},
        urls: {},
        back_urls: {},
    };
}

KansasClient.prototype.bind = function(name, fn) {
    this._hooks[name] = fn
    return this;
}

KansasClient.prototype.send = function(tag, data) {
    this._ws.send(tag, data);
}

KansasClient.prototype.connect = function(onOpen) {
    this._state = 'offline';
    this._ws = $.websocket(
        "ws:///" + hostname + ":" + ip_port + "/kansas",
        { open: this._onOpen,
          close: this._onClose,
          events: this._eventHandlers});
    return this;
}

KansasClient.prototype.get_ids = function() {
    /* TODO */
}

KansasClient.prototype.get_serverpos = function(id) {
    /* TODO */
}

KansasClient.prototype.get_stack = function(pos_type, serverpos) {
    /* TODO */
}

KansasClient.prototype.get_front_url = function(id) {
    /* TODO */
}

KansasClient.prototype.get_back_url = function(id) {
    /* TODO */
}

KansasClient.prototype.newBulkMoveTxn = function() {
    /* TODO */
}

KansasClient.prototype._onOpen = function() {
    console.log("ws:open");
    this._state = 'opened';
};

KansasClient.prototype._onClose = function() {
    console.log("ws:close");
    this._state = 'offline'
    this._ws = null;
    this._notify('disconnected');
}

KansasClient.prototype._reset = function(state) {
    /* TODO reset local cache using state */
    this._notify('reset');
}

KansasClient.prototype._eventHandlers = {
    _default: function(e) {
        console.log("Unhandled response: " + JSON.stringify(e));
    },
    broadcast_resp: function() {
        /* Ignore */
    },
    error: function(e) {
        this._notify('error', e.data);
    },
    broadcast_message: function(e) {
        this._notify('broadcast', e.data);
    },
    list_games_resp: function(e) {
        this._notify('listgames', e.data);
    },
    connect_resp: function(e) {
        this._state = 'connected';
        this._reset(e.data[0]);
    },
    resync_resp: function(e) {
        this._reset(e.data[0]);
    },
    reset: function(e) {
        this._reset(e.data[0]);
    },
    stackupdate: function(e) {
        /* TODO update local cache */
        this._notify('stackchanged', e.data.op.dest_key);
    },
    bulkupdate: function(e) {
        /* TODO update local cache */
        /* TODO call hooks on all changed stacks */
    },
    presence: function(e) {
        this._notify('presence', e.data);
    },
}

KansasClient.prototype._notify = function(hook, arg) {
    console.log('invoke hook: ' + hook);
    this._hooks[hook](arg);
}

KansasClient.prototype._hooks = {
    error: function(data) {},
    broadcast: function(data) {},
    listgames: function(data) {},
    stackchanged: function(data) {},
    reset: function() {},
    disconnected: function() {},
}
