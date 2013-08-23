peer.js
=======

useless general-purpose p2p network for node.js
author: Leonardo - http://github.com/leofiore

Usage:
------

    var peer = require('peer');
    peer.listen('some.inter.face.ip',   // listen on an interface. Every peer
         function(){                    // is identified by ip:public_ip 
             peer.connect('some.exter.nal.ip');
         });
    
    ...
    peer.setQuery(function(id){ ... });    // installs a query function. Everytime
                                           // a peer receives a 'whohas' message
                                           // this function is used to search a
                                           // result. If no results are given, 
                                           // returns false. 
    
    peer.search('id');    // starts a search through the network 


Messages protocol:
------------------

* **'helo'** - handshake message mutually sent after a new connection;
       `{helo:{ from:'', to:ip, publicip:<true|false> }}`
* **'letmeintr'** - after a helo message, a peer introduce some of its neightbours
                to his new friend
       `{cmd:'letmeintr', argv:{from:'', myfriends:[ <ip list> ]}}`
* **'whohas'** - sent through the network by flooding, looking for a string. Every
             message can be relaunched up to 10 times 
       `{cmd:'whohas', argv:{from:'', hop:'', id:'', ttl:10} }`
* **'tellto'** - reply sent through the reverse path to reach the original peer
             who sent the first 'whohas' message, informing of a successful hit
       `{cmd:'tellto', argv:{from:'', to:'', id:'', payload:{}}`
* **'seeya'** - the peer disconnects
       `{cmd:'seeya', argv:{from: id}}`
* **'ping'** - nuff 'said
       `{cmd:'ping', argv:{from: id}}`
* **'pong'** - same as ping
       `{cmd:'pong', argv:{from: id}}`


Events:
-------

* **'listening'** - peer is active and listening
* **'search'** [id] - a 'whohas' message has been received
* **'result'** [id, payload] - a peer replied with a hit to the search
* **'ping'** [from] - a ping.
* **'end'** [from] - a peer disconnects
* **'peer'** [from] - a new peer appears
