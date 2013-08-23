#!usr/bin/env node
/*jshint node:true*/
/* 
 * peer.js - useless general-purpose p2p network for node.js
 * author: leonardo
 *
 * Usage:
 * ------
 * 
 * var peer = require('peer');
 * peer.listen('some.inter.face.ip',   // listen on an interface. Every peer
 *      function(){                    // is identified by ip:public_ip 
 *          peer.connect('some.exter.nal.ip');
 *      });
 *
 * ...
 * peer.setQuery(function(id){ ... });    // installs a query function. Everytime
 *                                        // a peer receives a 'whohas' message
 *                                        // this function is used to search a
 *                                        // result. If no results are given, 
 *                                        // returns false. 
 *
 * peer.search('id');    // starts a search through the network 
 *
 *
 * Messages protocol:
 * ------------------
 *
 * 'helo' - handshake message mutually sent after a new connection;
 *      {helo:{ from:'', to:ip, publicip:<true|false> }}
 *
 * 'letmeintr' - after a helo message, a peer introduce some of its neightbours
 *               to his new friend
 *      {cmd:'letmeintr', argv:{from:'', myfriends:[ <ip list> ]}}
 *
 * 'whohas' - sent through the network by flooding, looking for a string. Every
 *            message can be relaunched up to 10 times 
 *      {cmd:'whohas', argv:{from:'', hop:'', id:'', ttl:10} }
 *
 * 'tellto' - reply sent through the reverse path to reach the original peer
 *            who sent the first 'whohas' message, informing of a successful hit
 *      {cmd:'tellto', argv:{from:'', to:'', id:'', payload:{}}
 *
 * 'seeya' - the peer disconnects
 *      {cmd:'seeya', argv:{from: id}}
 *
 * 'ping' - nuff 'said
 *      {cmd:'ping', argv:{from: id}}
 *
 * 'pong' - same as ping
 *      {cmd:'pong', argv:{from: id}}
 * 
 *
 * Events:
 * -------
 *
 * 'listening' - peer is active and listening
 *
 * 'search' [id] - a 'whohas' message has been received
 *
 * 'result' [id, payload] - a peer replied with a hit to the search
 *
 * 'ping' [from] - a ping.
 *
 * 'end' [from] - a peer disconnects
 *
 * 'peer' [from] - a new peer appears
 *
 */

module.exports = (function(){
   "use strict";

var net = require('net'),
    http = require('http'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    emitter = new EventEmitter(),
    ipaddr = '',
    ipext = '',
    ippublic = false,
    searchfun = function(){ return false; },
    queries = [],
    httpopts = {
        host: "checkip.dyndns.org",
        port: 80,
        method: "GET",
        path: "/"
    },

    friends = {}, // nodes 
    bestfriends = {}, // nodes with public ip
    reversepath = {}, // route table for reply

    peeractions = {
        rcv: {

            letmeintr: function(from, myfriends){
                console.log('[RCV] ' + from + ' introducing me to his friends: ' + util.inspect(myfriends));
                myfriends.sort().filter(function(el, idx, ar){ return ar[idx] !== ar[idx-1];})
                .forEach(function(el){
                    try {
                        if (el)
                            peerconnect(el);
                    }
                    catch(e) {}
                }); 
            },

            whohas: function(from, hop, id, ttl){
                console.log('[RCV] ' + from + ' (via ' + hop + ') looking for ' + id);
                if (queries.filter(function(el){ return el.from === from  && el.id === id && el.ttl >= ttl; }).length > 0){
                    console.log('skipping this query');
                    return;
                }
                if (!reversepath[from])
                    reversepath[from] = [];
                reversepath[from].push({conn: friends[hop].conn, ttl: 10 - ttl + 1});

                if (!ttl)
                    return;
                queries.push({from: from, id: id, ttl: ttl});
                emitter.emit('search', id);
                console.log('Calling search function...');
                var result = searchfun(id);
                if (result) {
                    console.log('We have a hit!');
                    peeractions.send.tellto(ipaddr + ':' + ipext,
                                           from, id, result);
                } else {
                for (var f in friends)
                    if (f !== hop){
                        console.log('Forwarding search... to ' + from);
                        peeractions.send.whohas(from, f, id, --ttl);
                    }
                }
            },
            tellto: function(from, to, id, payload){
                console.log('[RCV] ' + from + ' announce he has ' + id + ' for ' + to);
                if (to !== ipaddr + ':' + ipext){
                    peeractions.send.tellto(from, to, id, payload); 
                }
                else 
                    emitter.emit('result', id, payload);
            },
            seeya: function(from){
                console.log('[RCV] ' + from + ' disconnects');
                try {
                    peeractions.send.ping(from);
                } catch(e) {
                    friends[from].conn.end();
                        //unfriend(el);
                }
            },
            ping: function(from){
                console.log('[RCV] ' + from + ' pings');
                emitter.emit('ping', from);
                peeractions.send.pong(from);
            },
            pong: function(from){
                friends[from].ping = Date.now();
            }
        },
        send: {
            _send: function(conn, obj) {
                conn.write(JSON.stringify(obj) + '\n');
            },

            letmeintr: function(to){
                var f = [],
                    bf = [];
                for (var i in friends)
                    if (i !== to)
                        f.push(friends[i].conn.remoteAddress);
                for (var k in bestfriends)
                    if(k !== to)
                        bf.push(bestfriends[k].conn.remoteAddress);
                console.log('[SEND] introduce ' + to + ' to my friends');

                f.sort(function s(a,b){return a > Math.random * b;});
                bf.sort(function s(a,b){return a > Math.random * b;});

                peeractions.send._send(friends[to].conn, {
                    cmd: 'letmeintr',
                    argv: {
                        from: ipaddr + ':' + ipext,
                        myfriends: f.slice(0,3).concat(bf.slice(0,3))
                    }
                });
            },

            whohas: function(from, to, id, ttl){
                console.log('[SEND] asking ' + to + ' for ' + id);
                peeractions.send._send(friends[to].conn, {
                    cmd: 'whohas',
                    argv: {
                        from: from || ipaddr + ':' + ipext,
                        hop: ipaddr + ':' + ipext,
                        id: id,
                        ttl: ttl || 10
                    }
                });
            },

            tellto: function(from, to, id, payload){
                var route = reversepath[to];

                console.log('[SEND] replying ' + to + ' for ' + id);
                route.sort(function (a,b){return a.ttl < b.ttl;});
                peeractions.send._send(route[0].conn, {
                    cmd: 'tellto',
                    argv: {
                        from: from,
                        to: to,
                        id: id,
                        payload: payload || {}
                    }
                });
            },

            seeya: function(to){
                console.log('[SEND] leaving from ' + to);
                peeractions.send._send(friends[to].conn, {
                    cmd: 'seeya',
                    argv: {
                        from: ipaddr + ':' + ipext
                    }
                });
            },
            
            ping: function(to){
                console.log('[SEND] ping to ' + to);
                peeractions.send._send(friends[to].conn, {
                    cmd: 'ping',
                    argv: {
                        from: ipaddr + ':' + ipext
                    }
                });
            },

            pong: function(to){
                console.log('[SEND] pong to ' + to);
                peeractions.send._send(friends[to].conn, {
                    cmd: 'pong',
                    argv: {
                        from: ipaddr + ':' + ipext
                    }
                });
            }
        }
    },

    explode = function(argv){
        var args = [];
        for (var arg in argv)
            args.push(argv[arg]);
        return args;
    },

    handshake = function(conn){
        console.log('new connection to ' + conn.remoteAddress);
        var messages = [];
        conn.on('data', function(data){
            try {
                var buf = data.toString().split('\n');
                if (!buf.length)
                    return;
                if (messages.length)
                    messages[messages.length - 1] = messages[messages.length - 1] +  buf.shift();
                messages = messages.concat(buf.filter(function(el){
                    return el.length;
                }));
            } catch (e) {
            }
            try {
                while (messages.length){
                    processdata(JSON.parse(messages[0]), conn);
                    messages.shift();
                }
            } catch(e) {
                console.log(e);
                console.log('ERROR: ' + data);
            }
        })
        .on('error', function(){
            console.log('[ERROR] Unable to connect to ' + conn.remoteAddress);
        })
        .on('timeout', function(){
            console.log('[ERROR] Unable to connect to ' + conn.remoteAddress);
        });
        peeractions.send._send(conn, {
            helo: {
                from: ipaddr + ':' + ipext,
                to: conn.remoteAddress,
                publicip: ippublic
            }
        });
    },

    prunefriends = function(conn){
        for (var f in friends)
            if (friends[f].conn === conn) {
                unfriend(f);
                return;
            }
    },

    unfriend = function(from){
        function filter(el){ return el !== friends[from].conn; }

        for (var dest in reversepath) {
            reversepath[dest] = reversepath[dest]
                .filter(filter);
        }

        delete friends[from];
        delete bestfriends[from];
        delete reversepath[from];
        queries = queries.filter(function(el){
            return (el.from !== from);
        });
        emitter.emit('end', from);
    },

    processdata = function(json, conn){
        if (json.helo) {
            friends[json.helo.from] = {
                conn: conn,
                ping: Date.now(),
                visible: (json.helo.to === ipaddr)
            };
            if (json.helo.publicip)
                bestfriends[json.helo.from] = friends[json.helo.from]; 
            reversepath[json.helo.from] = [{conn: conn, ttl: 0}];
            conn.on('end', function end(){
                console.log('[END] ' + json.helo.from );
                prunefriends(conn);
                //unfriend(json.helo);
            })
            .on('timeout', function timeout(){
                console.log('[TIMEOUT] ' + json.helo.from );
                //unfriend(json.helo);
                prunefriends(conn);
            })
            .on('error', function error(){
                console.log('[ERROR] ' + json.helo.from );
                //unfriend(json.helo);
                prunefriends(conn);
            })
            .on('close', function error(){
                console.log('[CLOSE] ' + json.helo.from );
                //unfriend(json.helo);
                prunefriends(conn);
            });
            peeractions.send.letmeintr(json.helo.from);
            emitter.emit('peer', json.helo.from);
        }
        else if (json.cmd) {
            peeractions.rcv[json.cmd].apply(this, explode(json.argv));
        }
    },

    alreadyfriends = function(ip){
        for (var f in friends)
            if (friends[f].conn.remoteAddress === ip)
                return true;
        return false;
    },

    peerconnect = function(ip){
        var conn = (alreadyfriends(ip)? null :
        net.createConnection({
            port: 9099,
            host: ip
        }, function(){
            handshake(conn);
        }).on('error',
        function(){
            console.log('[ERROR] unable to connect to ' + ip);
        }));
    },

    pinginterval = setInterval(function(){
        var d = Date.now();
        for (var f in friends){
            if ((d - friends[f].ping) > 128000)
                peeractions.send.ping(f);
        }
    }, 25000),

    server = net.createServer(function(conn) {
        handshake(conn);
    });
    server.on('listening', function(){
        emitter.emit('listening');
    })
    .on('timeout', function(){
        console.log('[ERROR] Unable to connect to ');
    });


return {
    listen: function(ip, callback){
        ipaddr = ip;
        http.get(httpopts, function(res){
            var txt = '';
            if (res.statusCode != 200)
                return;
            res.on('data', function(chunk){ txt += chunk; })
               .on('error', function(data){console.log(data);})
               .on('end', function(){
                    ipext = txt.match(/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/).shift();
                    if (ipext === ipaddr)
                        ippublic = true;

                    server.listen(9099, ipaddr, 511, callback);
               });
        });
    },
    connect: function(ip, callback) {
        if (callback)
            emitter.on('peer', callback);
        peerconnect(ip);
    },
    setQuery: function(callback){
        searchfun = callback;
    },
    unsetQuery: function(callback){
        searchfun = function(){ return false; };
    },
    search: function(id, callback){
        if (callback)
            emitter.on('result', callback);
        for (var f in friends)
            peeractions.send.whohas(null, f, id);
    },
    on: function on(evt, callback){
        emitter.on(evt, callback);
    },
    addListener: function(evt, callback){
        emitter.addListener(evt, callback);
    },
    once: function(evt, callback){
        emitter.once(evt, callback);
    },
    removeListener: function(evt, callback){
        emitter.removeListener(evt, callback);
    },
    removeAllListeners: function(evt){
        emitter.removeAllListeners(evt);
    },
    listeners: function(evt){
        return emitter.listeners(evt);
    }

};

})();
