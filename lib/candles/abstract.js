

let async = require('async'),
	request = require('request'),
	moment = require('moment'),
	_ = require('underscore'),
	logger = require('../../utils/logger');

function AbstractCandles(client) {
	const self = this;

	this.name = 'exchange';
	this.key = `${this.name}Candles`;
	this.url = '';
	this.start = null;
	this.end = null;
	this.last = null;

	this.response = {
		error: 'message',
		data: 'data',
	};

	this.candle = {
		id: 'tid',
		date: 'date',
		price: 'price',
		amount: 'amount',
	};

	this.duration = 'minute';
	this.durations = ['minute', 'hour', 'day'];

	this.retrieveTrades = function (start, end, cb) {
		let found = false,
			results = [];

		logger.info('Candles:', 'Retrieving trades from', `${self.name}...`);

		async.doUntil(
			(next) => {
				logger.info(`Candles: Start: ${start ? new Date(start * 1000).toISOString() : 'N/A'} End: ${end ? new Date(end * 1000).toISOString() : 'N/A'}`);

				request.get({
					url: self.url + (start ? `&start=${start}` : '') + (end ? `&end=${end}` : ''),
					json: true,
				}, (err, resp, body) => {
					if (err || resp.statusCode !== 200) {
						return next(err || 'Response was unsuccessful');
					}

					const message = body[self.response.error];
					if (message) {
						return next(message);
					}

					const data = self.rejectTrades(body[self.response.data] || body);
					if (!self.validData(data)) {
						logger.error('Candles:', 'Invalid data received');
						return next();
					}

					if (self.validTrades(results, data)) {
						logger.info('Candles:', (start ? start.toString() : 'N/A'), 'to', (end ? end.toString() : 'N/A'), '=> Found', data.length.toString(), 'trades');
						results = self.acceptTrades(results, data);
						end = self.nextEnd(data);
						return next();
					}
					found = true;
					return next();
				});
			},
			() => found,
			(err) => {
				if (err) {
					return cb(`Error retrieving trades: ${err}`);
				}
				logger.info('Candles:', results.length.toString(), 'trades in total retrieved');
				return cb(null, results);
			});
	};

	this.nextEnd = function (data) {
		return null;
	};

	this.rejectTrades = function (data) {
		if (self.last) {
			return _.reject(data, trade => (!trade ? true : trade[self.candle.id] <= self.last.lastTrade));
		}
		return data;
	};

	this.validData = function (data) {
		if (_.size(data) > 0) {
			return _.first(data)[self.candle.id];
		}
		return true;
	};

	this.validTrades = function (results, data) {
		const any = _.size(data) > 0;

		if (any && _.size(results) > 0) {
			let firstLast = _.first(results)[self.candle.id] !== _.last(data)[self.candle.id],
				lastFirst = _.last(results)[self.candle.id] !== _.first(data)[self.candle.id];

			return (firstLast && lastFirst);
		}
		return any;
	};

	this.acceptTrades = function (results, data) {
		return results.concat(data);
	};

	this.parseDate = function (date) {
		if (typeof date === 'string') {
			return moment.utc(date).startOf(self.duration);
		}
		return moment.unix(date).utc().startOf(self.duration);
	};

	this.groupTrades = function (results, cb) {
		const groups = _.groupBy(results, trade => self.parseDate(trade[self.candle.date]).unix());

		return cb(null, groups);
	};

	this.sumTrades = function (results, cb) {
		let sum = _.map(results, period => ({
			timestamp: self.parseDate(period[0][self.candle.date]).unix(),
			date: self.parseDate(period[0][self.candle.date]).toDate(),
			high: _.max(period, t => parseFloat(t[self.candle.price]))[self.candle.price],
			low: _.min(period, t => parseFloat(t[self.candle.price]))[self.candle.price],
			open: _.first(period)[self.candle.price],
			close: _.last(period)[self.candle.price],
			liskVolume: _.reduce(period, (memo, t) => (memo + parseFloat(t[self.candle.amount])), 0.0).toFixed(8),
			btcVolume: _.reduce(period, (memo, t) => (memo + parseFloat(t[self.candle.amount]) * parseFloat(t[self.candle.price])), 0.0).toFixed(8),
			firstTrade: _.first(period)[self.candle.id],
			lastTrade: _.last(period)[self.candle.id],
			nextEnd: self.nextEnd(period),
			numTrades: _.size(period),
		}));

		sum = _.reject(sum, s => s.timestamp >= moment.utc().startOf(self.duration).unix());

		return cb(null, sum);
	};

	this.candleKey = function (duration) {
		if (!duration) {
			duration = self.duration;
		}
		return (`${self.key}:by${duration[0].toUpperCase()}${duration.slice(1)}`);
	};

	this.saveCandles = function (results, cb) {
		let multi = client.multi(),
			key = self.candleKey();

		_.each(results, (candle) => {
			multi.RPUSH(key, JSON.stringify(candle));
		});

		multi.exec((err, replies) => {
			if (err) {
				return cb(err);
			}
			logger.info('Candles:', replies.length.toString(), 'candles saved');
			return cb(null, results);
		});
	};

	this.restoreCandles = function (duration, index, cb) {
		client.LRANGE(self.candleKey(duration), index, -1, (err, reply) => {
			if (err) {
				return cb(err);
			}
			reply = JSON.parse(`[${reply.toString()}]`);
			logger.info('Candles:', reply.length.toString(), 'candles restored');
			return cb(null, reply);
		});
	};

	this.buildCandles = function (cb) {
		async.waterfall([
			function (waterCb) {
				return self.retrieveTrades(self.start, self.end, waterCb);
			},
			function (trades, waterCb) {
				async.eachSeries(self.durations, (duration, eachCb) => {
					self.duration = duration;
					return _buildCandles(trades, eachCb);
				}, (err, results) => {
					if (err) {
						return waterCb(err);
					}
					return waterCb(null);
				});
			},
		],
		(err, results) => {
			if (err) {
				return cb(err);
			}
			return cb(null, results);
		});
	};

	var _buildCandles = function (trades, cb) {
		logger.info('Candles:', 'Building', self.duration, 'candles for', `${self.name}...`);

		async.waterfall([
			function (waterCb) {
				client.DEL(self.candleKey(), (err, res) => {
					if (err) {
						return waterCb(err);
					}
					return waterCb();
				});
			},
			function (waterCb) {
				return self.groupTrades(trades, waterCb);
			},
			function (results, waterCb) {
				return self.sumTrades(results, waterCb);
			},
			function (results, waterCb) {
				return self.saveCandles(results, waterCb);
			},
		],
		(err, results) => {
			if (err) {
				return cb(err);
			}
			return cb(null, results);
		});
	};

	this.updateCandles = function (cb) {
		async.waterfall([
			function (callback) {
				self.duration = self.durations[0]; // Reset current duration
				client.LRANGE(self.candleKey(), -1, -1, (err, reply) => {
					if (err) {
						return callback(err);
					} else if (_.size(reply) === 0) {
						return callback(`No data was found for: ${self.name}`);
					}
					self.last = JSON.parse(reply);
					return callback(null, self.last);
				});
			},
			function (last, waterCb) {
				return self.retrieveTrades(last.nextEnd, null, waterCb);
			},
			function (trades, waterCb) {
				async.eachSeries(self.durations, (duration, eachCb) => {
					self.duration = duration;
					return _updateCandles(trades, eachCb);
				}, (err, results) => {
					if (err) {
						return waterCb(err);
					}
					return waterCb(null);
				});
			},
		],
		(err, results) => {
			if (err) {
				return cb(err);
			}
			return cb(null);
		});
	};

	var _updateCandles = function (trades, cb) {
		logger.info('Candles:', 'Updating', self.duration, 'candles for', `${self.name}...`);

		async.waterfall([
			function (waterCb) {
				return self.groupTrades(trades, waterCb);
			},
			function (results, waterCb) {
				return self.sumTrades(results, waterCb);
			},
			function (results, waterCb) {
				return self.saveCandles(results, waterCb);
			},
		],
		(err, results) => {
			if (err) {
				return cb(err);
			}
			return cb(null, results);
		});
	};
}

module.exports = AbstractCandles;
