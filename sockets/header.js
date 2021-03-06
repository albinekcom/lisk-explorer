

let api = require('../lib/api'),
	config = require('../config'),
	async = require('async'),
	logger = require('../utils/logger');

module.exports = function (app, connectionHandler, socket) {
	let blocks = new api.blocks(app),
		common = new api.common(app),
		delegates = new api.delegates(app),
		connection = new connectionHandler('Header:', socket, this),
		intervals = [],
		data = {},
		tmpData = {};

	const running = {
		getBlockStatus: false,
		getPriceTicker: false,
		getDelegateProposals: false,
	};

	this.onInit = function () {
		this.onConnect(); // Prevents data wipe

		async.parallel([
			getBlockStatus,
			getPriceTicker,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				data.status = res[0];
				data.ticker = res[1];

				log('info', 'Emitting new data');
				socket.emit('data', data);

				newInterval(0, 10000, emitData);
				// Update and emit delegate proposals every 10 minutes by default
				newInterval(1, config.proposals.updateInterval || 600000, emitDelegateProposals);
			}
		});

		emitDelegateProposals();
	};

	this.onConnect = function () {
		log('info', 'Emitting existing delegate proposals');
		socket.emit('delegateProposals', tmpData.proposals);

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
		logger[level]('Header:', msg);
	};

	var newInterval = function (i, delay, cb) {
		if (intervals[i] !== undefined) {
			return null;
		}
		intervals[i] = setInterval(cb, delay);
		return intervals[i];
	};

	var getBlockStatus = function (cb) {
		if (running.getBlockStatus) {
			return cb('getBlockStatus (already running)');
		}
		running.getBlockStatus = true;
		blocks.getBlockStatus(
			(res) => { running.getBlockStatus = false; cb('Status'); },
			(res) => { running.getBlockStatus = false; cb(null, res); });
	};

	var getPriceTicker = function (cb) {
		if (running.getPriceTicker) {
			return cb('getPriceTicker (already running)');
		}
		running.getPriceTicker = true;
		common.getPriceTicker(
			(res) => { running.getPriceTicker = false; cb('PriceTicker'); },
			(res) => { running.getPriceTicker = false; cb(null, res); });
	};

	const getDelegateProposals = function (cb) {
		if (running.getDelegateProposals) {
			return cb('getDelegateProposals (already running)');
		}
		running.getDelegateProposals = true;
		return delegates.getDelegateProposals(
			(res) => { running.getDelegateProposals = false; cb('DelegateProposals'); },
			(res) => { running.getDelegateProposals = false; cb(null, res); });
	};

	var emitData = function () {
		const thisData = {};

		async.parallel([
			getBlockStatus,
			getPriceTicker,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				thisData.status = res[0];
				thisData.ticker = res[1];

				data = thisData;
				log('info', 'Emitting data');
				socket.emit('data', thisData);
			}
		});
	};

	var emitDelegateProposals = function () {
		if (!config.proposals.enabled) {
			return false;
		}

		async.parallel([
			getDelegateProposals,
		],
		(err, res) => {
			if (err) {
				log('error', `Error retrieving: ${err}`);
			} else {
				tmpData.proposals = res[0];
			}

			log('info', 'Emitting updated delegate proposals');
			socket.emit('delegateProposals', tmpData.proposals);
		});
	};
};
