/**
 * KansasView - translates server positions into screen coordinates.
 * e.g. for two people looking at a board from different angles.
 *
 * Usage:
 *      var view = KansasView(kclient, 2, [0, 0], [800, 600]);
 *      kclient.getCoord(id|jquery) -> (int, int)
 *      kclient.posToCoord(pos: int) -> (int, int)
 *
 *  to mutate game state:
 *      view.startBulkMove()
 *          .move(id1, x1, y1)
 *          .moveOnto(id2, id1)
 *          .moveToHand(id2, handid)
 *          .move(id3, x2, y2)
 *          .flip(id4)
 *          .unflip(id5)
 *          .rotate(id6)
 *          .unrotate(id7)
 *          .commit()
 */

function KansasView(kclient, rotation, translation, bbox) {
    if (translation.length != 2) {
        throw "translation must be of form [int, int]";
    }
    if (bbox.length != 2) {
        throw "bounding box must be of form [int, int]";
    }
    if (rotation != 0 && rotation != 2) {
        throw "unsupported rotation: must be one of {0, 2}"
    }
    this.client = kclient;
    this.rotation = rotation;
    this.translation = translation;
    this.width = bbox[0];
    this.height = bbox[1];
    this.maxGridIndex = 0x7ff;
    this.warning = this.client.ui.warning;
}

(function() {  /* begin namespace kview */

function keyFromCoords(view, x, y) {
    var xRatio = Math.min(1, Math.max(0, x / view.width));
    var yRatio = Math.min(1, Math.max(0, y / view.height));
    return Math.ceil(xRatio * view.maxGridIndex)
        | Math.ceil(yRatio * view.maxGridIndex) << 16;
}

/* Extracts x-coord from key. */
function keyToX(view, key) {
    return ((key & 0xffff) / view.maxGridIndex) * view.width;
}

/* Extracts y-coord from key. */
function keyToY(view, key) {
    return ((key >> 16) / view.maxGridIndex) * view.height;
}

/* Translates x from server view to geometry on screen. */
function toClientX(view, x) {
    return toCanonicalX(view, x, true);
}

/* Translates y from server view to geometry on screen. */
function toClientY(view, y) {
    return toCanonicalY(view, y, true);
}

/* Translates x from geometry on screen to server view. */
function toCanonicalX(view, x, invert) {
    if (invert) {
        x -= view.translation[0];
    }
    switch (view.rotation) {
        case 0:
            /* no-op */
            break;
        case 2:
            /* mirror X */
            x = view.width - x;
            break;
        default:
            view.warning("Unsupported client rotation: " + view.rotation);
            break;
    }
    if (!invert) {
        x += view.translation[0];
    }
    return x;
}

/* Translates y from geometry on screen to server view. */
function toCanonicalY(view, y, invert) {
    if (invert) {
        y -= view.translation[1];
    }
    switch (view.rotation) {
        case 0:
            /* no-op */
            break;
        case 2:
            /* mirror Y */
            y = view.height - y;
            break;
        default:
            view.warning("Unsupported client rotation: " + clientRotation);
            break;
    }
    if (!invert) {
        y += view.translation[1];
    }
    return y;
}

/* Translates locations from geometry on screen to server view. */
KansasView.prototype.toCanonicalKey = function(clientKey) {
    if (isNaN(clientKey)) {
        return clientKey;
    }
    var x = keyToX(clientKey);
    var y = keyToY(clientKey);
    return keyFromCoords(this, toCanonicalX(this, x), toCanonicalY(this, y));
}

function toId(id) {
    if (isNaN(id)) {
        /* converts jquery selection to integer id */
        id = parseInt(id.prop("id").substr(5));
    }
    return id;
}

KansasView.prototype.posToCoord = function(board_pos) {
    if (isNaN(board_pos))
        throw "cannot coordinatify position: " + board_pos;

    var canonicalKey = parseInt(board_pos);
    var x = keyToX(this, canonicalKey);
    var y = keyToY(this, canonicalKey);
    return [toClientX(this, x), toClientY(this, y)];
}


KansasView.prototype.getCoord = function(id) {
    id = toId(id);
    return this.posToCoord(this.client.getPos(id)[1]);
}

function KansasViewTxn(client, view) {
    this.view = view;
    this.client = client;
    this.movebuffer = {};
    this.committed = false;
}

KansasViewTxn.prototype._initEmptyMove = function(buf, id) {
    if (buf[id] === undefined) {
        buf[id] = {
            dest_type: this.client.getPos(id)[0],
            dest_key: this.client.getPos(id)[1],
            dest_orient: this.client.getOrient(id),
        };
    }
}

KansasViewTxn.prototype.move = function(id, x, y) {
    id = toId(id);
    var buf = this.movebuffer;
    this._initEmptyMove(buf, id);
    buf[id].dest_type = 'board';
    buf[id].dest_key = keyFromCoords(
        this.view,
        toCanonicalX(this.view, x),
        toCanonicalY(this.view, y));
    return this;
}

KansasViewTxn.prototype.moveOnto = function(id, id_target) {
    id = toId(id);
    id_target = toId(id_target);
    var buf = this.movebuffer;
    this._initEmptyMove(buf, id);
    buf[id].dest_type = this.client.getPos(id_target)[0];
    buf[id].dest_key = this.client.getPos(id_target)[1];
    return this;
}

KansasViewTxn.prototype.moveToHand = function(id, hand_id) {
    id = toId(id);
    var buf = this.movebuffer;
    this._initEmptyMove(buf, id);
    buf[id].dest_type = 'hands';
    buf[id].dest_key = hand_id;
    return this;
}

KansasViewTxn.prototype.flip = function(id) {
    id = toId(id);
    var orient = this.client.getOrient(card);
    if (orient > 0) {
        var buf = this.movebuffer;
        this._initEmptyMove(buf, id);
        buf[id].orientation = - orient;
    }
    return this;
}

KansasViewTxn.prototype.unflip = function(id) {
    id = toId(id);
    var orient = this.client.getOrient(card);
    if (orient < 0) {
        var buf = this.movebuffer;
        this._initEmptyMove(buf, id);
        buf[id].orientation = - orient;
    }
    return this;
}

KansasViewTxn.prototype.rotate = function(id) {
    id = toId(id);
    var orient = getOrient(card);
    if (Math.abs(orient) == 1) {
        var buf = this.movebuffer;
        this._initEmptyMove(buf, id);
        buf[id].orientation = Math.abs(Math.abs(orient) / orient * 2);
    }
    return this;
}

KansasViewTxn.prototype.unrotate = function(id) {
    id = toId(id);
    var orient = getOrient(card);
    if (Math.abs(orient) != 1) {
        var buf = this.movebuffer;
        this._initEmptyMove(buf, id);
        buf[id].orientation = Math.abs(orient) / orient;
    }
    return this;
}

KansasViewTxn.prototype.commit = function() {
    if (this.committed)
        throw "bulk move already committed";
    var bulkmove = this.client.newBulkMoveTxn();
    for (id in this.movebuffer) {
        var move = this.movebuffer[id];
        bulkmove.append(id, move.dest_type, move.dest_key, move.dest_orient);
    }
    bulkmove.commit();
    this.committed = true;
}

KansasView.prototype.startBulkMove = function() {
    return new KansasViewTxn(this.client, this);
}

})();  /* end namespace kview */
