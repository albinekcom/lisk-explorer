

let api = require('../lib/api'),
	async = require('async'),
	logger = require('../utils/logger');

module.exports = function (app, connectionHandler, socket) {
	let statistics = new api.statistics(app),
		connection = new connectionHandler('Network Monitor:', socket, this),
		intervals = [],
		data = {};

	const running = {
		getlastBlock: false,
		getBlocks: false,
		getPeers: false,
	};

	this.onInit = function () {
		this.onConnect();

		async.parallel([
			getLastBlock,
			getBlocks,
			getPeers,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				data.lastBlock = res[0];
				data.blocks = res[1];
				data.peers = res[2];

				log('info', 'Emitting new data');
				socket.emit('data', data);

				newInterval(0, 5000, emitData1);
				// FIXME: Here we are pulling 8640 blocks - logic should be changed
				newInterval(1, 300000, emitData2);
				newInterval(2, 5000, emitData3);
			}
		});
	};

	this.onConnect = function () {
		log('info', 'Emitting existing data');
		socket.emit('data', data);
	};

	this.onDisconnect = function () {
		for (let i = 0; i < intervals.length; i++) {
			clearInterval(intervals[i]);
		}
		intervals = [];
	};

	// Private

	var log = function (level, msg) {
		logger[level]('Network Monitor:', msg);
	};

	var newInterval = function (i, delay, cb) {
		if (intervals[i] !== undefined) {
			return null;
		}
		intervals[i] = setInterval(cb, delay);
		return intervals[i];
	};

	var getLastBlock = function (cb) {
		if (running.getLastBlock) {
			return cb('getLastBlock (already running)');
		}
		running.getLastBlock = true;
		statistics.getLastBlock(
			(res) => { running.getLastBlock = false; cb('LastBlock'); },
			(res) => { running.getLastBlock = false; cb(null, res); });
	};

	var getBlocks = function (cb) {
		if (running.getBlocks) {
			return cb('getBlocks (already running)');
		}
		running.getBlocks = true;
		statistics.getBlocks(
			(res) => { running.getBlocks = false; cb('Blocks'); },
			(res) => { running.getBlocks = false; cb(null, res); });
	};

	var getPeers = function (cb) {
		if (running.getPeers) {
			return cb('getPeers (already running)');
		}
		running.getPeers = true;
		statistics.getPeers(
			(res) => { running.getPeers = false; cb('Peers'); },
			(res) => { running.getPeers = false; cb(null, res); });
	};

	var emitData1 = function () {
		const thisData = {};

		async.parallel([
			getLastBlock,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				thisData.lastBlock = data.lastBlock = res[0];

				log('info', 'Emitting data-1');
				socket.emit('data1', thisData);
			}
		});
	};

	var emitData2 = function () {
		const thisData = {};

		async.parallel([
			getBlocks,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				thisData.blocks = data.blocks = res[0];

				log('info', 'Emitting data-2');
				socket.emit('data2', thisData);
			}
		});
	};

	var emitData3 = function () {
		const thisData = {};

		async.parallel([
			getPeers,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				thisData.peers = data.peers = res[0];

				log('info', 'Emitting data-3');
				socket.emit('data3', thisData);
			}
		});
	};
};

