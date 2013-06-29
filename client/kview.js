/**
 * KansasView - translates server positions into screen coordinates.
 * e.g. for two people looking at a board from different angles.
 *
 * Usage:
 *      var view = KansasView(kclient, 2, [0, 0]);
 *      kclient.get_coord(id) -> (int, int)
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
function KansasView(kclient, rotation, translation) {
    if (translation.length != 2) {
        throw "translation must be of form [int, int]";
    }
    if (rotation != 0 && rotation != 2) {
        throw "unsupported rotation: must be one of {0, 2}"
    }
    this.client = kclient;
    this.rotation = rotation;
    this.translation = translation;
}

KansasView.prototype.get_coord = function(id) {
    /* TODO */
}

KansasView.prototype.startBulkMove = function() {
    /* TODO */
}
