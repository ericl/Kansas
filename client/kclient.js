/**
 * Kansas websocket client - talks to server and notifies of updates.
 *
 * Usage:
 *
 *  var kclient = KansasClient(hostname, ip_port, kansas_ui)
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
 *      kclient.getOrient(id) -> int
 *      kclient.getStack(pos_type, pos) -> list[int]
 *      kclient.heightOf(id) -> int in [0, max_int]
 *      kclient.heightOfStack(id) -> int in [1, max_int]
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

function KansasClient(hostname, ip_port, kansas_ui) {
    this.hostname = hostname;
    this.ip_port = ip_port;
    this.ui = kansas_ui;
    this._ws = null;
    this._state = 'offline';
    this._game = {
        state: {},
        index: {},
    };
}

function KansasBulkMove(client) {
    this.moves = [];
    this.client = client;
}

KansasBulkMove.prototype.append = function(id, dest_type, dest, orient) {
    this.moves.push({
        card: id,
        dest_prev_type: this.client.getPos(id)[0],
        dest_type: dest_type,
        dest_key: dest,
        dest_orient: orient,
    });
}

KansasBulkMove.prototype.send = function() {
    this.client.send("bulkmove", {moves: this.moves});
}

KansasClient.prototype.bind = function(name, fn) {
    if (this._hooks[name] === undefined)
        throw "hook '" + name + "' not defined";
    this._hooks[name] = fn
    return this;
}

KansasClient.prototype.send = function(tag, data) {
    this.ui.showSpinner();
    this._ws.send(tag, data);
}

KansasClient.prototype.connect = function() {
    this.ui.showSpinner();
    if (this._state != 'offline')
        throw "can only connect from 'offline' state";
    this._state = 'opening';
    this._ws = $.websocket(
        "ws:///" + this.hostname + ":" + this.ip_port + "/kansas",
        { open: this._onOpen(this),
          close: this._onClose(this),
          events: this._eventHandlers(this)});
    return this;
}

KansasClient.prototype.listAll = function() {
    var acc = [];
    for (key in this._game.state.board) {
        acc.push.apply(acc, this._game.state.board[key]);
    }
    for (key in this._game.state.hands) {
        acc.push.apply(acc, this._game.state.hands[key]);
    }
    return acc;
}

KansasClient.prototype.getPos = function(id) {
    return this._game.index[id];
}

KansasClient.prototype.getOrient = function(id) {
    return this._game.state.orientations[id];
}

KansasClient.prototype.heightOf = function(id) {
    var pos = this.getPos(id);
    var stack = this.getStack(pos[0], pos[1]);
    return stack.indexOf(id);
}

KansasClient.prototype.heightOfStack = function(id) {
    var pos = this.getPos(id);
    var stack = this.getStack(pos[0], pos[1]);
    return stack.length;
}

KansasClient.prototype.getStack = function(pos_type, pos) {
    return this._game.state[pos_type][pos];
}

KansasClient.prototype.getFrontUrl = function(id) {
    return this._game.state.urls[id];
}

KansasClient.prototype.getBackUrl = function(id) {
    return this._game.state.back_urls[id] || this._game.state.default_back_url;
}

KansasClient.prototype.newBulkMoveMessage = function() {
    return new KansasBulkMove(this);
}

KansasClient.prototype._onOpen = function(that) {
    return function() {
        that.ui.log("ws:open");
        that._state = 'opened';
        that._notify('opened');
    };
}

KansasClient.prototype._onClose = function(that) {
    return function() {
        that.ui.log("ws:close");
        that._state = 'offline'
        that._ws = null;
        that._notify('disconnected');
    };
}

/**
 * Utility that removes an element from an array.
 * Returns if the element was present in the array.
 */
function removeFromArray(arr, item) {
    var idx = $.inArray(item, arr);
    if (idx >= 0) {
        arr.splice(idx, 1);
        return true;
    } else {
        return false;
    }
}

KansasClient.prototype._eventHandlers = function(that) {
    return {
        _default: function(e) {
            that.ui.hideSpinner();
            that.ui.log("Unhandled response: " + JSON.stringify(e));
        },
        broadcast_resp: function() {
            that.ui.hideSpinner();
        },
        error: function(e) {
            that._notify('error', e.data);
        },
        broadcast_message: function(e) {
            that._notify('broadcast', e.data);
        },
        list_games_resp: function(e) {
            that._notify('listgames', e.data);
        },
        connect_resp: function(e) {
            that._state = 'connected';
            that._reset(e.data[0]);
        },
        resync_resp: function(e) {
            that._reset(e.data[0]);
        },
        reset: function(e) {
            that._reset(e.data[0]);
        },
        stackupdate: function(e) {
            var op = e.data.op;

            that._game.state[op.dest_type][op.dest_key] = e.data.z_stack;
            for (i in e.data.z_stack) {
                var id = e.data.z_stack[i];
                that._game.state.orientations[id] = e.data.orient[i];
            }

            that._notify('stackchanged', [op.dest_type, op.dest_key]);
        },
        bulkupdate: function(e) {
            var stacksTouched = {};

            for (i in e.data) {
                var data = e.data[i];
                var dest_k = data.dest_key;
                var dest_t = data.dest_type;
                stacksTouched[JSON.stringify([dest_t, dest_k])] = true;
                that._game.state[dest_t][dest_k] = data.z_stack;

                for (j in data['updates']) {
                    var update = data['updates'][j];
                    var id = update.move.card;
                    var old_t = update.old_type;
                    var old_k = update.old_key;

                    stacksTouched[JSON.stringify([old_t, old_k])] = true;
                    removeFromArray(that._game.state[old_t][old_k], id);

                    if (that._game.state[old_t][old_k].length == 0) {
                        delete that._game.state[old_t][old_k];
                    }
                }
            }

            for (skey in stacksTouched) {
                that._notify('stackchanged', JSON.parse(skey));
            }
        },
        presence: function(e) {
            that._notify('presence', e.data);
        },
    };
}

KansasClient.prototype._reset = function(state) {
    this._game.state = state;

    this._game.index = {};
    for (ns in {board:0, hands:0}) {
        for (key in this._game.state[ns]) {
            var stack = this._game.state[ns][key];
            for (idx in stack) {
                var id = stack[idx];
                this._game.index[id] = [ns, key];
            }
        }
    }

    this._notify('reset');
}

KansasClient.prototype._notify = function(hook, arg) {
    this.ui.hideSpinner();
    this.ui.log('invoke hook: ' + hook);
    this._hooks[hook](arg);
}

KansasClient.prototype._hooks = {
    opened: function() {},
    error: function(data) {},
    disconnected: function() {},
    listgames: function(data) {},
    broadcast: function(data) {},
    presence: function(data) {},
    stackchanged: function(data) {},
    reset: function() {},
}
