# Implements simple persistence of namespaces via leveldb.

import leveldb
import pickle


_databases = {}
def _GetDB(dbPath):
    """Returns or creates a LevelDB instance stored at dbPath."""

    if dbPath not in _databases:
        _databases[dbPath] = leveldb.LevelDB(dbPath)
    return _databases[dbPath]


_meta = {}
def _GetMeta(dbPath):
    """Returns the meta table, which is a list of all other tables."""

    if dbPath not in _meta:
        _meta[dbPath] = Namespace(dbPath, '__META__', version=0)
    return _meta[dbPath]


def ListNamespaces(dbPath):
    """Lists all namespaces registered in the meta table."""

    meta = _GetMeta(dbPath)
    return list(meta)


class Namespace(object):
    """Returns a named, versioned subpartition of a LevelDB instance."""

    def __init__(self, dbpath, name, version=0, serializer=pickle, _prefix=''):
        if ':' in name:
            raise ValueError("name must not contain ':'")
        self.dbpath = dbpath
        self.db = _GetDB(dbpath)
        self.name = name
        self.version = version
        self.serializer = serializer
        self.prefix = str(_prefix)
        if name != '__META__' and not _prefix:
            meta = _GetMeta(dbpath)
            meta.Put(name, (name, version, str(serializer)))

    def _key(self, key):
        if type(key) not in [unicode, str, int, float, long]:
            raise ValueError("key must be atomic type, was '%s'" % type(key))
        key = str(key)
        return '%s.v%d:%s' % (self.name, self.version, self.prefix + key)

    def _invkey(self, internal_key):
        assert ':' in internal_key
        return internal_key.split(':', 1)[1][len(self.prefix):]

    def Subspace(self, name):
        return Namespace(
            self.dbpath,
            self.name,
            self.version,
            self.serializer,
            self.prefix + '\0' + name)

    def Put(self, key, value):
        self.db.Put(self._key(key), self.serializer.dumps(value))

    def Delete(self, key):
        self.db.Delete(self._key(key))

    def Get(self, key):
        try:
            return self.serializer.loads(self.db.Get(self._key(key)))
        except KeyError:
            return None

    def __contains__(self, key):
        return self.Get(key) is not None

    def __iter__(self):
        for k, v in self.db.RangeIter(self._key('\x00'), self._key('\xff')):
            yield self._invkey(k), self.serializer.loads(v)

    def __str__(self):
        return str(list(self))

    def __repr__(self):
        return str(self)


if __name__ == '__main__':
    path = '../db'
    print _GetDB(path).GetStats()
    print '-- Namespaces --'
    for name, stats in ListNamespaces(path):
        print name, stats
        print "num keys =", len(list(Namespace(path, name, version=stats[1])))
