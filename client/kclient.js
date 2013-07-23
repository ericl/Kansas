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
 *      var fut = kclient.callAsync(msg_type, msg_payload);
 *      fut.then(myCallback).then(mySecondCallback);
 *
 *  to send raw messages:
 *      kclient.send(msg_type, args);
 *
 *  to reconnect:
 *      kclient.connect(scopeName);
 *
 *  See kclient._hooks for more information on adding hooks.
 *
 *  to query game state:
 *      kclient.futuresPending() -> int
 *      kclient.dropFutures() -> void
 *      kclient.listAll() -> list[int]
 *      kclient.listStacks(pos_type) -> list[any]
 *      kclient.getPos(id|jquery) -> (type: str, pos: any)
 *      kclient.getOrient(id|jquery) -> int
 *      kclient.getStack(pos_type, pos) -> list[int]
 *      kclient.getStackTop(pos_type, pos) -> int
 *      kclient.stackIndex(id|jquery) -> int in [0, max_int]
 *      kclient.stackHeight(id|jquery) -> int in [1, max_int] or 0
 *      kclient.stackOf(id|jquery) -> list[int]
 *      kclient.inHand(id|jquery{set}) -> bool
 *      kclient.getSmallUrl(id|jquery) -> str
 *      kclient.getFrontUrl(id|jquery) -> str
 *      kclient.getBackUrl(id|jquery) -> str
 *
 *  low-level mutation methods for game state:
 *  (generally, prefer using KansasView for mutations)
 *      kclient.newBulkMoveTxn()
 *          .append(id1, pos_type_a, pos_a, server_orient_a)
 *          .append(id2, pos_type_a, pos_a, server_orient_b)
 *          .append(id3, pos_type_b, pos_b, server_orient_c)
 *          .commit();
 */

function KansasClient(hostname, ip_port, kansas_ui) {
    this.hostname = hostname;
    this.ip_port = ip_port;
    this.ui = kansas_ui;
    this.halted = false;
    this.scope = 'DEFAULT_SCOPE';
    this._ws = null;
    this._futures = {};
    this._state = 'offline';
    this._game = {
        state: {},
        index: {},
    };
    var that = this;
    setInterval(function() {
        if (that._state == 'connected') {
            that._ws.send('keepalive');
        }
    }, 30000);
}

(function() {  /* begin namespace kclient */

function KansasBulkMove(client) {
    this.moves = [];
    this.client = client;
}

function toId(id) {
    if (isNaN(id)) {
        /* converts jquery selection to integer id */
        var str = id.prop("id");
        id = parseInt(str.substr(5));
        if (isNaN(id)) {
            throw "Failed to parse: " + str;
        }
    }
    return id;
}

KansasBulkMove.prototype.append = function(id, dest_type, dest, orient) {
    if (dest_type == 'board')
        dest = parseInt(dest);
    id = toId(id);
    this.moves.push({
        card: parseInt(id),
        dest_prev_type: this.client.getPos(id)[0],
        dest_type: dest_type,
        dest_key: dest,
        dest_orient: orient,
    });
    return this;
}

KansasBulkMove.prototype.commit = function() {
    var state = this.client._game.state;

    for (i in this.moves) {
        var move = this.moves[i];
        var id = move.card;
        var oldpos = this.client.getPos(id);
        removeFromArray(state[oldpos[0]][oldpos[1]], id);
        if (!state[move.dest_type])
            state[move.dest_type] = {};
        if (!state[move.dest_type][move.dest_key])
            state[move.dest_type][move.dest_key] = [];
        state[move.dest_type][move.dest_key].push(id);
        state.orientations[id] = move.dest_orient;
        this.client._game.index[id] = [move.dest_type, move.dest_key];
    }

    this.client.ui.vlog(3, "bulkmove: " + JSON.stringify(this.moves));
    this.client.send("bulkmove", {moves: this.moves});
}

KansasClient.prototype.futuresPending = function() {
    return Object.keys(this._futures).length;
}

KansasClient.prototype.dropFutures = function() {
    this._futures = {};
}

KansasClient.prototype._removeEntry = function(pos, id) {
    removeFromArray(this._game.state[pos[0]][pos[1]], id);
    if (this._game.state[pos[0]][pos[1]] &&
            this._game.state[pos[0]][pos[1]].length == 0) {
        delete this._game.state[pos[0]][pos[1]];
    }
    delete this._game.index[id];
}

KansasClient.prototype.bind = function(name, fn) {
    if (this._hooks[name] === undefined)
        throw "hook '" + name + "' not defined";
    this._hooks[name] = fn
    return this;
}

/* Sends message and returns a pending Future for the result.
 * The client will be "Loading..." as long as the Future is pending. */
KansasClient.prototype.callAsync = function(tag, data) {
    this.ui.showSpinner("sending " + tag);
    var fut = new Future(tag);
    if (this._ws != null) {
        this._ws.send(tag, data, fut.id);
        this._futures[fut.id] = fut;
    }
    return fut;
}

/* Sends message without creating a Future.
 * The client will be "Loading..." until any ack is received on the socket. */
KansasClient.prototype.send = function(tag, data) {
    this.ui.showSpinner("send " + tag);
    if (this._ws != null) {
        this._ws.send(tag, data);
    }
}

KansasClient.prototype.connect = function() {
    if (!this.scope)
        throw "must set scope name";
    if (this.halted)
        throw "client halted";
    this.ui.showSpinner("connect");
    if (this._state != 'offline')
        throw "can only connect from 'offline' state";
    this._state = 'opening';
    var that = this;
    this._futures = {};
    this._ws = $.websocket(
        "ws:///" + this.hostname + ":" + this.ip_port + "/kansas",
        { open: function() {
            that._ws.send("set_scope", that.scope);
            that._onOpen.call(that);
          },
          close: function() { that._onClose.call(that); },
          events: this._eventHandlers(that) });
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

KansasClient.prototype.listStacks = function(ns) {
    var acc = [];
    for (key in this._game.state[ns]) {
        acc.push(key);
    }
    return acc;
}

KansasClient.prototype.getPos = function(id) {
    id = toId(id);
    return this._game.index[id];
}

KansasClient.prototype.getOrient = function(id) {
    id = toId(id);
    return this._game.state.orientations[id];
}

KansasClient.prototype.stackIndex = function(id) {
    id = toId(id);
    var pos = this.getPos(id);
    var stack = this.getStack(pos[0], pos[1]);
    if (stack == undefined) {
        return -1;
    } else {
        return stack.indexOf(id);
    }
}

KansasClient.prototype.stackOf = function(id) {
    id = toId(id);
    var pos = this.getPos(id);
    var stack = this.getStack(pos[0], pos[1]);
    return stack;
}

KansasClient.prototype.inHand = function(ids) {
    if (isNaN(ids)) {
        if (ids.length == 1) {
            if (!ids.hasClass("card"))
                return false;
            return this.getPos(ids)[0] == "hands";
        } else {
            var inHand = false;
            var that = this;
            $.each(ids, function() {
                if (that.getPos($(this))[0] == "hands")
                    inHand = true;
            });
            return inHand;
        }
    } else {
        return this.getPos(ids)[0] == "hands";
    }
}

KansasClient.prototype.stackHeight = function(id) {
    id = toId(id);
    var pos = this.getPos(id);
    var stack = this.getStack(pos[0], pos[1]);
    if (stack == undefined) {
        return 0;
    } else {
        return stack.length;
    }
}

KansasClient.prototype.getStack = function(pos_type, pos) {
    return this._game.state[pos_type][pos];
}

KansasClient.prototype.getStackTop = function(pos_type, pos) {
    var stack = this.getStack(pos_type, pos);
    return stack[stack.length - 1];
}

KansasClient.prototype.getSmallUrl = function(id) {
    id = toId(id);
    return this._game.state.urls_small[id] || this.getFrontUrl(id);
}

KansasClient.prototype.getFrontUrl = function(id) {
    id = toId(id);
    return this._game.state.urls[id];
}

KansasClient.prototype.getBackUrl = function(id) {
    id = toId(id);
    return this._game.state.back_urls[id] || this._game.state.default_back_url;
}

KansasClient.prototype.newBulkMoveTxn = function() {
    return new KansasBulkMove(this);
}

KansasClient.prototype._onOpen = function() {
    this.ui.vlog(3, "ws:open");
    this._state = 'opened';
    this._notify('opened');
}

KansasClient.prototype._onClose = function() {
    this.ui.vlog(3, "ws:close");
    this._state = 'offline'
    this._notify('disconnected', null, true);
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
        _future_router: function(e) {
            if (that._futures[e.future_id]) {
                that._futures[e.future_id].complete(e.data);
                delete that._futures[e.future_id];
            } else {
                that.ui.vlog(0, "Dropped future: " + JSON.stringify(e.future_id));
            }
            that.ui.hideSpinner();
        },
        _default: function(e) {
            that.ui.hideSpinner();
            that.ui.vlog(0, "Unhandled response: " + JSON.stringify(e));
        },
        error: function(e) {
            that._notify('error', e.msg);
        },
        broadcast_message: function(e) {
            that._notify('broadcast', e.data);
        },
        broadcast_resp: function(e) {
            that.ui.hideSpinner();
        },
        connect_resp: function(e) {
            that._state = 'connected';
            that._reset(e.data[0]);
        },
        bulk_remove: function(e) {
            for (i in e.data) {
                var id = e.data[i];
                that._removeEntry(that.getPos(id), id);
            }
            that._notify('removed', e.data);
        },
        bulk_add: function(e) {
            var state = that._game.state;
            var added = [];
            for (i in e.data.cards) {
                var add = e.data.cards[i];
                var stack = state[add.pos[0]][add.pos[1]];
                added.push(add.id);
                if (!stack) {
                    state[add.pos[0]][add.pos[1]] = [add.id];
                } else {
                    state[add.pos[0]][add.pos[1]].push(add.id);
                }
                state.orientations[add.id] = add.orient;
                state.urls[add.id] = add.url;
                state.urls_small[add.id] = add.small_url;
                that._game.index[add.id] = add.pos;
            }
            that._notify('added', {'cards': added, 'requestor': e.data.requestor});
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
                    if (old_t != dest_t || old_k != dest_k) {
                        that._removeEntry([old_t, old_k], id);
                    }
                    that._game.index[id] = [dest_t, dest_k];
                    that._game.state.orientations[id] = update.move.dest_orient;
                }
            }

            for (skey in stacksTouched) {
                that._notify('stackchanged', JSON.parse(skey));
            }
        },
        presence: function(e) {
            that._notify('presence', e.data, true);
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

KansasClient.prototype._notify = function(hook, arg, keep_spinner) {
    if (!keep_spinner) {
        this.ui.hideSpinner();
        this.ui.vlog(3, "hide spinner for response to: " + hook);
    }
    this.ui.vlog(3, 'invoke hook: ' + hook);
    this._hooks[hook](arg);
}

KansasClient.prototype._hooks = {
    opened: function() {},
    error: function(data) {},
    disconnected: function() {},
    broadcast: function(data) {},
    presence: function(data) {},
    stackchanged: function(data) {},
    reset: function() {},
    removed: function(data) {},
    added: function(data) {},
}

})();  /* end namespace kclient */
