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
 *      kclient.listAll() -> list[int]
 *      kclient.getPos(id) -> (type: str, pos: any)
 *      kclient.getStack(pos_type, pos) -> list[int]
 *      kclient.getFrontUrl(id) -> str
 *      kclient.getBackUrl(id) -> str
 *
 *  low-level mutation methods for game state:
 *  (generally, prefer using KansasView for mutations)
 *      kclient.applyStackOp(pos_type, pos, op);
 *      kclient.newBulkMoveMessage()
 *          .append(id1, pos_type_a, pos_a, server_orient_a)
 *          .append(id2, pos_type_a, pos_a, server_orient_b)
 *          .append(id3, pos_type_b, pos_b, server_orient_c)
 *          .send();
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

KansasClient.prototype.listAll = function() {
    /* TODO */
}

KansasClient.prototype.getPos = function(id) {
    /* TODO */
}

KansasClient.prototype.getStack = function(pos_type, pos) {
    /* TODO */
}

KansasClient.prototype.getFrontUrl = function(id) {
    /* TODO */
}

KansasClient.prototype.getBackUrl = function(id) {
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
