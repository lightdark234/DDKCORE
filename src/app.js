/**
 * A node-style callback as used by {@link logic} and {@link modules}.
 * @see {@link https://nodejs.org/api/errors.html#errors_node_js_style_callbacks}
 * @callback nodeStyleCallback
 * @param {?Error} error - Error, if any, otherwise `null`.
 * @param {Data} data - Data, if there hasn't been an error.
 */
/**
 * A triggered by setImmediate callback as used by {@link logic}, {@link modules} and {@link helpers}.
 * Parameters formats: (cb, error, data), (cb, error), (cb).
 * @see {@link https://nodejs.org/api/timers.html#timers_setimmediate_callback_args}
 * @callback setImmediateCallback
 * @param {function} cb - Callback function.
 * @param {?Error} [error] - Error, if any, otherwise `null`.
 * @param {Data} [data] - Data, if there hasn't been an error and the function should return data.
 */

import ModuleTransactions from 'src/modules/transactions';
/**
 * Main entry point.
 * Loads the ddk modules, the ddk api and run the express server as Domain master.
 * CLI options available.
 * @module app
 */

// Requiring Modules
require('dotenv').config();
require('auto-strict');
const async = require('async');
const fs = require('fs');
const genesisblock = require('./helpers/genesisBlock');
const git = require('./helpers/git.js');
const packageJson = require('../package.json');
const path = require('path');
const program = require('commander');
const httpApi = require('./helpers/httpApi.js');
const Sequence = require('./helpers/sequence.js');
const dbSequence = require('./helpers/dbSequence.js');
const balanceSequence = require('./helpers/balanceSequence.js');
const z_schema = require('./helpers/z_schema.js');
const Logger = require('./logger.js');

const logman = new Logger();
const logger = logman.logger;
const {AccountSessions} = require('./helpers/accountSessions');
const utils = require('./utils');
const elasticsearchSync = require('./helpers/elasticsearch');
const referal = require('./helpers/referal');
const cronjob = require('node-cron-job');
const serverRPCConfig = require('./api/rpc/server.config');
const ServerRPCApi = require('./api/rpc/server');
const jobs = require('./jobs.js');


process.stdin.resume();

const versionBuild = fs.readFileSync(path.join(__dirname, 'build'), 'utf8');

/**
 * @property {string} - Hash of last git commit.
 */
let lastCommit = '';

program
    .version(packageJson.version)
    .option('-c, --config <path>', 'config file path')
    .option('-p, --port <port>', 'listening port number')
    .option('-a, --address <ip>', 'listening host name or ip')
    .option('-x, --peers [peers...]', 'peers list')
    .option('-l, --log <level>', 'log level')
    .option('-s, --snapshot <round>', 'verify snapshot')
    .parse(process.argv);


/**
 * @property {object} - The default list of configuration options. Can be updated by CLI.
 * @default 'config.json'
 */
const appConfig = require('./helpers/config.js')(program.config);

if (program.port) {
    appConfig.port = program.port;
}

if (program.address) {
    appConfig.address = program.address;
}

if (program.peers) {
    if (typeof program.peers === 'string') {
        appConfig.peers.list = program.peers.split(',').map((peer) => {
            peer = peer.split(':');
            return {
                ip: peer.shift(),
                port: peer.shift() || appConfig.port
            };
        });
    } else {
        appConfig.peers.list = [];
    }
}

if (program.log) {
    appConfig.consoleLogLevel = program.log;
}

appConfig.loading.snapshot = null;
if (program.snapshot) {
    appConfig.loading.snapshot = Math.abs(
        Math.floor(program.snapshot)
    );
    appConfig.api.enabled = false;
    appConfig.peers.enabled = false;
    appConfig.peers.list = [];
    appConfig.broadcasts.active = false;
    appConfig.syncing.active = false;
}

/**
 * The config object to handle ddk modules and ddk api.
 * It loads `modules` and `api` folders content.
 * Also contains db configuration from config.json.
 * @property {object} db - Config values for database.
 * @property {object} modules - `modules` folder content.
 * @property {object} api - `api/http` folder content.
 */
const config = {
    db: appConfig.db,
    cache: appConfig.redis,
    cacheEnabled: appConfig.cacheEnabled,
    modules: {
        server: require('./modules/server.js'),
        accounts: require('./modules/accounts.js'),
        transactions: ModuleTransactions,
        blocks: require('./modules/blocks.js'),
        signatures: require('./modules/signatures.js'),
        transport: require('./modules/transport.js'),
        loader: require('./modules/loader.js'),
        system: require('./modules/system.js'),
        peers: require('./modules/peers.js'),
        delegates: require('./modules/delegates.js'),
        rounds: require('./modules/rounds.js'),
        // dapps: require('./modules/dapps.js'),
        crypto: require('./modules/crypto.js'),
        sql: require('./modules/sql.js'),
        cache: require('./modules/cache.js'),
        frogings: require('./modules/frogings.js'),
        // sendFreezeOrder: require('./modules/sendFreezeOrder.js')
    },
    api: {
        accounts: { http: require('./api/http/accounts.js') },
        blocks: { http: require('./api/http/blocks.js') },
        // dapps: { http: require('./api/http/dapps.js') },
        delegates: { http: require('./api/http/delegates.js') },
        loader: { http: require('./api/http/loader.js') },
        peers: { http: require('./api/http/peers.js') },
        server: { http: require('./api/http/server.js') },
        signatures: { http: require('./api/http/signatures.js') },
        transactions: { http: require('./api/http/transactions.js') },
        transport: { http: require('./api/http/transport.js') },
        frogings: { http: require('./api/http/froging.js') },
        // sendFreezeOrder: { http: './api/http/transferorder.js' }
    }
};

// merge environment variables
const env = require('./config/env');

utils.merge(appConfig, env);

// Trying to get last git commit
try {
    lastCommit = git.getLastCommit();
} catch (err) {
    logger.debug('Cannot get last git commit', err.message);
}

/**
 * Creates the express server and loads all the Modules and logic.
 * @property {object} - Domain instance.
 */
const d = require('domain').create();

d.on('error', (err) => {
    logger.error('Domain master', { message: err.message, stack: err.stack });
    process.exit(0);
});

d.run(() => {
    const modules = [];
    async.auto({
        /**
         * Loads `payloadHash` and generate dapp password if it is empty and required.
         * Then updates config.json with new random  password.
         * @method config
         * @param {nodeStyleCallback} cb - Callback function with the mutated `appConfig`.
         * @throws {Error} If failed to assign nethash from genesis block.
         */
        config(cb) {
            try {
                appConfig.nethash = Buffer.from(genesisblock.payloadHash, 'hex').toString('hex');
            } catch (e) {
                logger.error('Failed to assign nethash from genesis block');
                throw Error(e);
            }

            // TODO useless code
            // if (appConfig.dapp.masterrequired && !appConfig.dapp.masterpassword) {
            //     const randomstring = require('randomstring');
            //
            //     appConfig.dapp.masterpassword = randomstring.generate({
            //         length: 12,
            //         readable: true,
            //         charset: 'alphanumeric'
            //     });
            //
            //     if (appConfig.loading.snapshot != null) {
            //         delete appConfig.loading.snapshot;
            //     }
            // }
            fs.writeFileSync('./config.json', JSON.stringify(appConfig, null, 4));
            cb(null, appConfig);
        },

        logger(cb) {
            cb(null, logger);
        },

        build(cb) {
            cb(null, versionBuild);
        },

        /**
         * Returns hash of last git commit.
         * @method lastCommit
         * @param {nodeStyleCallback} cb - Callback function with Hash of last git commit.
         */
        lastCommit(cb) {
            cb(null, lastCommit);
        },

        genesisblock(cb) {
            cb(null, {
                block: genesisblock
            });
        },

        public(cb) {
            cb(null, path.join(__dirname, 'public'));
        },

        schema(cb) {
            cb(null, new z_schema());
        },

        /**
         * Once config is completed, creates app, http & https servers & sockets with express.
         * @method network
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {nodeStyleCallback} cb - Callback function with created Object:
         * `{express, app, server, io, https, https_io}`.
         */
        network: ['config', function (scope, cb) {
            const express = require('express');
            const compression = require('compression');
            const cors = require('cors');
            const app = express();
            const Prometheus = require('./prometheus');

            // prometheus configuration
            app.use(Prometheus.requestCounters);
            app.use(Prometheus.responseCounters);
            Prometheus.injectMetricsRoute(app);
            Prometheus.startCollection();

            if (appConfig.coverage) {
                const im = require('istanbul-middleware');
                logger.debug('Hook loader for coverage - do not use in production environment!');
                im.hookLoader(__dirname);
                app.use('/coverage', im.createHandler());
            }

            require('./helpers/request-limiter')(app, appConfig);

            app.use(compression({ level: 9 }));
            app.use(cors());
            app.options('*', cors());

            const server = require('http').createServer(app);
            const io = require('socket.io')(server);

            let privateKey,
                certificate,
                https,
                https_io;

            if (scope.config.ssl.enabled) {
                privateKey = fs.readFileSync(scope.config.ssl.options.key);
                certificate = fs.readFileSync(scope.config.ssl.options.cert);

                https = require('https').createServer({
                    key: privateKey,
                    cert: certificate,
                    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:' + 'ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:' + '!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
                }, app);

                https_io = require('socket.io')(https);
            }

            const accountSessions = AccountSessions.getInstance();
            AccountSessions.setIOInstance(io);

            // handled socket's connection event
            io.on('connection', (socket) => {
                // IIFE: function to accept new socket.id in sockets array.
                function acceptSocket(user) {
                    if(user.address) {
                        accountSessions.put( user.address, socket.id );
                        io.sockets.emit('updateConnected', accountSessions.length);
                    }
                }

                socket.on('setUserAddress', (data) => {
                    const user = {
                        address: data.address,
                        status: 'online',
                        socketId: socket.id
                    };
                    acceptSocket(user);
                });

                socket.on('disconnect', () => {
                    accountSessions.remove( socket.id );
                    io.sockets.emit('updateConnected', accountSessions.length);
                });
            });

            cb(null, {
                express,
                app,
                server,
                io,
                https,
                https_io
            });
        }],

        dbSequence: ['logger', function (scope, cb) {
            const sequence = new dbSequence({
                onWarning(current) {
                    scope.logger.warn('DB queue', current);
                }
            });
            cb(null, sequence);
        }],

        sequence: ['logger', function (scope, cb) {
            const sequence = new Sequence({
                onWarning(current) {
                    scope.logger.warn('Main queue', current);
                }
            });
            cb(null, sequence);
        }],

        balancesSequence: ['logger', function (scope, cb) {
            const sequence = new balanceSequence({
                onWarning(current) {
                    scope.logger.warn('Balance queue', current);
                }
            });
            cb(null, sequence);
        }],

        /**
         * Once config, public, genesisblock, logger, build and network are completed,
         * adds configuration to `network.app`.
         * @method connect
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {function} cb - Callback function.
         */
        connect: ['config', 'public', 'genesisblock', 'logger', 'build', 'network', 'cache', function (scope, cb) {
            const path = require('path');
            const bodyParser = require('body-parser');
            const cookieParser = require('cookie-parser');
            const methodOverride = require('method-override');
            const queryParser = require('express-query-int');
            const randomString = require('randomstring');

            scope.nonce = randomString.generate(16);
            scope.network.app.engine('html', require('ejs').renderFile);
            scope.network.app.use(require('express-domain-middleware'));
            scope.network.app.set('view engine', 'ejs');
            scope.network.app.set('views', path.join(__dirname, 'public'));
            scope.network.app.use(scope.network.express.static(path.join(__dirname, 'public')));
            scope.network.app.use(bodyParser.raw({ limit: '2mb' }));
            scope.network.app.use(bodyParser.urlencoded({ extended: true, limit: '2mb', parameterLimit: 5000 }));
            scope.network.app.use(bodyParser.json({ limit: '2mb' }));
            scope.network.app.use(methodOverride());
            scope.network.app.use(cookieParser());

            const ignore = ['id', 'name', 'lastBlockId', 'blockId', 'transactionId', 'address', 'recipientId', 'senderId', 'previousBlock'];

            scope.network.app.use(queryParser({
                parser(value, radix, name) {
                    if (ignore.indexOf(name) >= 0) {
                        return value;
                    }

                    // Ignore conditional fields for transactions list
                    if (/^.+?:(blockId|recipientId|senderId)$/.test(name)) {
                        return value;
                    }

                    /* eslint-disable eqeqeq */
                    if (isNaN(value) || parseInt(value) != value || isNaN(parseInt(value, radix))) {
                        return value;
                    }
                    /* eslint-enable eqeqeq */
                    return parseInt(value);
                }
            }));

            scope.network.app.use(require('./helpers/z_schema-express.js')(scope.schema));

            scope.network.app.use(httpApi.middleware.logClientConnections.bind(null, scope.logger));

            /* Instruct browser to deny display of <frame>, <iframe> regardless of origin.
             *
             * RFC -> https://tools.ietf.org/html/rfc7034
             */
            scope.network.app.use(httpApi.middleware.attachResponseHeader.bind(null, 'X-Frame-Options', 'DENY'));
            /* Set Content-Security-Policy headers.
             *
             * frame-ancestors - Defines valid sources for <frame>, <iframe>, <object>, <embed> or <applet>.
             *
             * W3C Candidate Recommendation -> https://www.w3.org/TR/CSP/
             */
            scope.network.app.use(httpApi.middleware.attachResponseHeader.bind(null, 'Content-Security-Policy', 'frame-ancestors \'none\''));

            scope.network.app.use(httpApi.middleware.applyAPIAccessRules.bind(null, scope.config));

            cb();
        }],

        ed(cb) {
            cb(null, require('./helpers/ed.js'));
        },

        bus: ['ed', function (scope, cb) {
            const changeCase = require('change-case');
            const bus = function () {
                this.message = function () {
                    const args = [];
                    Array.prototype.push.apply(args, arguments);
                    const topic = args.shift();
                    const eventName = `on${changeCase.pascalCase(topic)}`;

                    // executes the each module onBind function
                    modules.forEach((module) => {
                        if (typeof (module[eventName]) === 'function') {
                            module[eventName].apply(module[eventName], args);
                        }
                        if (module.submodules) {
                            async.each(module.submodules, (submodule) => {
                                if (submodule && typeof (submodule[eventName]) === 'function') {
                                    submodule[eventName].apply(submodule[eventName], args);
                                }
                            });
                        }
                    });
                };
            };
            scope.logger.info('[App][loader][bus] loaded');
            cb(null, new bus());
        }],
        db(cb) {
            const db = require('./helpers/database.js');
            db.connect(config.db, logger, cb);
        },
        /**
         * It tries to connect with redis server based on config. provided in config.json file
         * @param {function} cb
         */
        cache(cb) {
            const cache = require('./helpers/cache.js');
            cache.connect(config.cacheEnabled, config.cache, logger, cb);
        },
        /**
         * Once db, bus, schema and genesisblock are completed,
         * loads transaction, block, account and peers from logic folder.
         * @method logic
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {function} cb - Callback function.
         */
        logic: ['db', 'bus', 'schema', 'genesisblock', function (scope, cb) {
            const Transaction = require('./logic/transaction.js');
            const Block = require('./logic/block.js');
            const Account = require('./logic/account.js');
            const Peers = require('./logic/peers.js');
            const Frozen = require('./logic/frozen.js');
            // let SendFreezeOrder = require('./logic/sendFreezeOrder.js');
            const Vote = require('./logic/vote.js');

            async.auto({
                bus(cb) {
                    cb(null, scope.bus);
                },
                db(cb) {
                    cb(null, scope.db);
                },
                ed(cb) {
                    cb(null, scope.ed);
                },
                logger(cb) {
                    cb(null, logger);
                },
                schema(cb) {
                    cb(null, scope.schema);
                },
                genesisblock(cb) {
                    cb(null, {
                        block: genesisblock
                    });
                },
                network(cb) {
                    cb(null, scope.network);
                },
                config(cb) {
                    cb(null, scope.config);
                },
                account: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'logger', function (scope, cb) {
                    new Account(scope.db, scope.schema, scope.logger, cb);
                }],
                transaction: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'account', 'logger', 'config', 'network', function (scope, cb) {
                    new Transaction(scope.db, scope.ed, scope.schema, scope.genesisblock, scope.account, scope.logger, scope.config, scope.network, cb);
                }],
                block: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'account', 'transaction', function (scope, cb) {
                    new Block(scope.ed, scope.schema, scope.transaction, cb);
                }],
                peers: ['logger', function (scope, cb) {
                    new Peers(scope.logger, cb);
                }],
                frozen: ['logger', 'db', 'transaction', 'network', 'config', function (scope, cb) {
                    new Frozen(scope.logger, scope.db, scope.transaction, scope.network, scope.config, scope.balancesSequence, scope.ed, cb);
                }],
                // sendFreezeOrder: ['logger', 'db', 'network', function (scope, cb) {
                // 	new SendFreezeOrder(scope.logger, scope.db, scope.network, cb);
                // }],
                vote: ['logger', 'schema', 'db', 'frozen', 'account', function (scope, cb) {
                    new Vote(scope.logger, scope.schema, scope.db, scope.frozen, scope.account, cb);
                }],
            }, (err, data) => {
                scope.logger.info('[App][loader][logic] loaded');
                cb(err, data);
            });
        }],
        /**
         * Once network, connect, config, logger, bus, sequence,
         * dbSequence, balancesSequence, db and logic are completed,
         * loads modules from `modules` folder using `config.modules`.
         * @method modules
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {nodeStyleCallback} cb - Callback function with resulted load.
         */
        modules: ['network', 'connect', 'config', 'logger', 'bus', 'sequence', 'dbSequence', 'balancesSequence', 'db', 'logic', 'cache', function (scope, cb) {
            const tasks = {};

            Object.keys(config.modules).forEach((name) => {
                tasks[name] = function (cb) {
                    const d = require('domain').create();

                    d.on('error', (err) => {
                        scope.logger.error(`Domain ${name}`, { message: err.message, stack: err.stack });
                    });

                    d.run(() => {
                        scope.logger.debug('Loading module', name);
                        const Klass = config.modules[name];
                        const obj = new Klass(cb, scope);
                        modules.push(obj);
                        scope.logger.debug(`[App][loader][modules][${name}] loaded`);
                    });
                };
            });

            async.parallel(tasks, (err, results) => {
                scope.logger.info('[App][loader][modules] loaded');
                cb(err, results);
            });
        }],
        binding: ['modules', 'bus', 'logic', function (scope, cb) {
            scope.logger.debug('[App][loader][binding] start loading');

            scope.bus.message('bind', scope.modules);
            scope.logic.transaction.bindModules(scope.modules);
            scope.logic.peers.bindModules(scope.modules);

            scope.logger.debug('[App][loader][binding] end binding');
            cb();
        }],
        applyGenesisBlock: ['binding', (scope, cb) => {
            scope.logger.debug('[App][loader][applyGenesisBlock] start loading');
            scope.modules.blocks.chain.saveGenesisBlock().then(() => {
                scope.logger.info('[App][loader][applyGenesisBlock] loaded');
                cb();
            });
        }],
        loadBlockChain: ['applyGenesisBlock', (scope, cb) => {
            scope.logger.debug('[App][loader][loadBlockChain] start loading');
            scope.modules.loader.loadBlockChain(() => {
                scope.logger.info('[App][loader][loadBlockChain] loaded');
                cb();
            });
        }],
        ready: ['loadBlockChain', function (scope, cb) {
            scope.logger.debug('[App][loader][ready] start loading');
            elasticsearchSync.sync(scope.db, scope.logger);
            scope.logger.info('[App][loader][ready] loaded');
            cb();
        }],

        /**
         * Loads api from `api` folder using `config.api`, once modules, logger and
         * network are completed.
         * @method api
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {function} cb - Callback function.
         */
        api: ['modules', 'logger', 'network', function (scope, cb) {
            Object.keys(config.api).forEach((moduleName) => {
                Object.keys(config.api[moduleName]).forEach((protocol) => {
                    const ApiEndpoint = config.api[moduleName][protocol];
                    try {
                        new ApiEndpoint(
                            scope.modules[moduleName],
                            scope.network.app,
                            scope.logger,
                            scope.modules.cache,
                            scope.config
                        );
                        scope.logger.debug(`[App][loader][api][${moduleName}] loaded`);
                    } catch (e) {
                        scope.logger.error(`Unable to load API endpoint for ${moduleName} of ${protocol}`, e);
                    }
                });
            });

            scope.network.app.use(httpApi.middleware.errorLogger.bind(null, scope.logger));
            scope.logger.info('[App][loader][api] loaded');
            cb();
        }],

        /**
         * Once 'ready' is completed, binds and listens for connections on the
         * specified host and port for `scope.network.server`.
         * @method listen
         * @param {object} scope - The results from current execution,
         * at leats will contain the required elements.
         * @param {nodeStyleCallback} cb - Callback function with `scope.network`.
         */
        listen: ['ready', function (scope, cb) {
            scope.network.server.listen(scope.config.port, scope.config.address, (err) => {
                scope.logger.info(`ddk started: ${scope.config.address}:${scope.config.app.port}`);

                if (!err) {
                    if (scope.config.ssl.enabled) {
                        scope.network.https.listen(scope.config.ssl.options.port, scope.config.ssl.options.address, (err) => {
                            scope.logger.info(`ddk https started: ${scope.config.ssl.options.address}:${scope.config.ssl.options.port}`);

                            cb(err, scope.network);
                        });
                    } else {
                        scope.logger.info('[App][loader][listen] loaded');
                        cb(null, scope.network);
                    }
                } else {
                    cb(err, scope.network);
                }
            });
        }],

        /**
         * Realisation of RPC protocol
         * @method listenWs
         * @param {object} scope - The results from current execution, at leats will contain the required elements.
         * @param {nodeStyleCallback} cb - Callback function with `scope.network`.
         */
        listenRPC: ['listen', function (scope, cb) {
            const server = new ServerRPCApi();
            serverRPCConfig.methods.map((method) => {
                server.register(method.methodName, params => method.call(null, server.getWebSocketServer(), params, scope));
            });
            scope.logger.info(`RPC Server started on: ${server.host}:${server.port}`);
            cb();
        }]

    }, (err, scope) => {
        if (err) {
            scope.logger.error(err.message);
        } else {
            // TODO: make it NORMAL
            cronjob.setJobsPath(path.join(process.cwd(), 'src', '/jobs.js'));  // Absolute path to the jobs module.
            jobs.attachScope(scope);
            referal.Referals(scope);

            cronjob.startJob('archiveLogFiles');
            /**
             * Handles app instance (acts as global variable, passed as parameter).
             * @global
             * @typedef {Object} scope
             * @property {Object} api - Undefined.
             * @property {undefined} balancesSequence - Sequence function, sequence Array.
             * @property {string} build - Empty.
             * @property {Object} bus - Message function, bus constructor.
             * @property {Object} config - Configuration.
             * @property {undefined} connect - Undefined.
             * @property {Object} db - Database constructor, database functions.
             * @property {function} dbSequence - Database function.
             * @property {Object} ed - Crypto functions from ddk node-sodium.
             * @property {Object} genesisblock - Block information.
             * @property {string} lastCommit - Hash transaction.
             * @property {Object} listen - Network information.
             * @property {Object} logger - Log functions.
             * @property {Object} logic - several logic functions and objects.
             * @property {Object} modules - Several modules functions.
             * @property {Object} network - Several network functions.
             * @property {string} nonce
             * @property {string} public - Path to ddk public folder.
             * @property {undefined} ready
             * @property {Object} schema - ZSchema with objects.
             * @property {Object} sequence - Sequence function, sequence Array.
             * @todo logic repeats: bus, ed, genesisblock, logger, schema.
             * @todo description for nonce and ready
             */
            scope.logger.info('Modules ready and launched');
            /**
             * Event reporting a cleanup.
             * @event cleanup
             */
            /**
             * Receives a 'cleanup' signal and cleans all modules.
             * @listens cleanup
             */
            process.once('cleanup', () => {
                scope.logger.info('Cleaning up...');
                async.eachSeries(modules, (module, cb) => {
                    if (typeof (module.cleanup) === 'function') {
                        module.cleanup(cb);
                    } else {
                        setImmediate(cb);
                    }
                }, (err) => {
                    if (err) {
                        scope.logger.error(err);
                    } else {
                        scope.logger.info('Cleaned up successfully');
                    }
                    process.exit(1);
                });
            });

            /**
             * Event reporting a SIGTERM.
             * @event SIGTERM
             */
            /**
             * Receives a 'SIGTERM' signal and emits a cleanup.
             * @listens SIGTERM
             */
            process.once('SIGTERM', () => {
                /**
                 * emits cleanup once 'SIGTERM'.
                 * @emits cleanup
                 */
                process.emit('cleanup');
            });

            /**
             * Event reporting an exit.
             * @event exit
             */
            /**
             * Receives an 'exit' signal and emits a cleanup.
             * @listens exit
             */
            process.once('exit', () => {
                /**
                 * emits cleanup once 'exit'.
                 * @emits cleanup
                 */
                process.emit('cleanup');
            });

            /**
             * Event reporting a SIGINT.
             * @event SIGINT
             */
            /**
             * Receives a 'SIGINT' signal and emits a cleanup.
             * @listens SIGINT
             */
            process.once('SIGINT', () => {
                /**
                 * emits cleanup once 'SIGINT'.
                 * @emits cleanup
                 */
                process.emit('cleanup');
            });
        }
    });
});

/**
 * Event reporting an uncaughtException.
 * @event uncaughtException
 */
/**
 * Receives a 'uncaughtException' signal and emits a cleanup.
 * @listens uncaughtException
 */
process.on('uncaughtException', (err) => {
    // Handle error safely
    logger.error('System error', { message: err.message, stack: err.stack });
    /**
     * emits cleanup once 'uncaughtException'.
     * @emits cleanup
     */
    // process.emit('cleanup'); // TODO Are u kidding me
});

/** ************************************* END OF FILE ************************************ */
