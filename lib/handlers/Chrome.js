import sdpTransform from 'sdp-transform';
import Logger from '../Logger';
import EnhancedEventEmitter from '../EnhancedEventEmitter';
import * as sdpCommonUtils from './sdp/commonUtils';
import RemotePlanBSdp from './sdp/RemotePlanBSdp';

const logger = new Logger('Chrome');

export class Handler extends EnhancedEventEmitter
{
	constructor(direction, rtpParametersByKind, settings)
	{
		super(logger);

		// RTCPeerConnection instance.
		// @type {RTCPeerConnection}
		this._pc = new RTCPeerConnection(
			{
				iceServers         : settings.turnServers || [],
				iceTransportPolicy : 'all',
				bundlePolicy       : 'max-bundle',
				rtcpMuxPolicy      : 'require'
			});

		// Generic sending RTP parameters for audio and video.
		// @type {Object}
		this._rtpParametersByKind = rtpParametersByKind;

		// Remote SDP handler.
		// @type {RemotePlanBSdp}
		this._remoteSdp = new RemotePlanBSdp(direction, rtpParametersByKind);

		// Handle RTCPeerConnection connection status.
		this._pc.addEventListener('iceconnectionstatechange', () =>
		{
			switch (this._pc.iceConnectionState)
			{
				case 'checking':
					this.emit('@connectionstatechange', 'connecting');
					break;
				case 'connected':
				case 'completed':
					this.emit('@connectionstatechange', 'connected');
					break;
				case 'failed':
					this.emit('@connectionstatechange', 'failed');
					break;
				case 'disconnected':
					this.emit('@connectionstatechange', 'disconnected');
					break;
				case 'closed':
					this.emit('@connectionstatechange', 'closed');
					break;
			}
		});
	}

	close()
	{
		logger.debug('close()');

		// Close RTCPeerConnection.
		try { this._pc.close(); }
		catch (error) {}
	}
}

export class RecvHandler extends Handler
{
	constructor(rtpParametersByKind, settings)
	{
		super('recv', rtpParametersByKind, settings);

		// Got transport remote parameters.
		// @type {Boolean}
		this._transportCreated = false;

		// Got transport local parameters.
		// @type {Boolean}
		this._transportUpdated = false;

		// Seen media kinds.
		// @type {Set<String>}
		this._kinds = new Set();

		// Map of Consumers information indexed by consumer.id.
		// - kind {String}
		// - trackId {String}
		// - ssrc {Number}
		// - rtxSsrc {Number}
		// - cname {String}
		// @type {Map<Number, Object>}
		this._consumerInfos = new Map();
	}

	addConsumer(consumer)
	{
		logger.debug(
			'addConsumer() [id:%s, kind:%s]', consumer.id, consumer.kind);

		if (this._consumerInfos.has(consumer.id))
			return Promise.reject(new Error('Consumer already added'));

		const encoding = consumer.rtpParameters.encodings[0];
		const cname = consumer.rtpParameters.rtcp.cname;
		const consumerInfo =
		{
			kind     : consumer.kind,
			streamId : `recv-stream-${consumer.id}`,
			trackId  : `consumer-${consumer.kind}-${consumer.id}`,
			ssrc     : encoding.ssrc,
			cname    : cname
		};

		if (encoding.rtx && encoding.rtx.ssrc)
			consumerInfo.rtxSsrc = encoding.rtx.ssrc;

		this._consumerInfos.set(consumer.id, consumerInfo);
		this._kinds.add(consumer.kind);

		return Promise.resolve()
			.then(() =>
			{
				if (!this._transportCreated)
					return this._setupTransport();
			})
			.then(() =>
			{
				const remoteSdp = this._remoteSdp.createOfferSdp(
					Array.from(this._kinds), Array.from(this._consumerInfos.values()));
				const offer = { type: 'offer', sdp: remoteSdp };

				logger.debug(
					'addConsumer() | calling pc.setRemoteDescription() [offer:%o]',
					offer);

				return this._pc.setRemoteDescription(offer);
			})
			.then(() =>
			{
				return this._pc.createAnswer();
			})
			.then((answer) =>
			{
				logger.debug(
					'addConsumer() | calling pc.setLocalDescription() [answer:%o]',
					answer);

				return this._pc.setLocalDescription(answer);
			})
			.then(() =>
			{
				if (!this._transportUpdated)
					return this._updateTransport();
			})
			.then(() =>
			{
				const stream = this._pc.getRemoteStreams()
					.find((s) => s.id === consumerInfo.streamId);
				const track = stream.getTrackById(consumerInfo.trackId);

				if (!track)
					throw new Error('remote track not found');

				return track;
			});
	}

	removeConsumer(consumer)
	{
		logger.debug(
			'removeConsumer() [id:%s, kind:%s]', consumer.id, consumer.kind);

		if (!this._consumerInfos.has(consumer.id))
			return Promise.reject(new Error('Consumer not found'));

		this._consumerInfos.delete(consumer.id);

		return Promise.resolve()
			.then(() =>
			{
				const remoteSdp = this._remoteSdp.createOfferSdp(
					Array.from(this._kinds), Array.from(this._consumerInfos.values()));
				const offer = { type: 'offer', sdp: remoteSdp };

				logger.debug(
					'removeConsumer() | calling pc.setRemoteDescription() [offer:%o]',
					offer);

				return this._pc.setRemoteDescription(offer);
			})
			.then(() =>
			{
				return this._pc.createAnswer();
			})
			.then((answer) =>
			{
				logger.debug(
					'removeConsumer() | calling pc.setLocalDescription() [answer:%o]',
					answer);

				return this._pc.setLocalDescription(answer);
			});
	}

	restartIce(remoteIceParameters)
	{
		logger.debug('restartIce()');

		// Provide the remote SDP handler with new remote ICE parameters.
		this._remoteSdp.updateTransportRemoteIceParameters(remoteIceParameters);

		return Promise.resolve()
			.then(() =>
			{
				const remoteSdp = this._remoteSdp.createOfferSdp(
					Array.from(this._kinds), Array.from(this._consumerInfos.values()));
				const offer = { type: 'offer', sdp: remoteSdp };

				logger.debug(
					'restartIce() | calling pc.setRemoteDescription() [offer:%o]',
					offer);

				return this._pc.setRemoteDescription(offer);
			})
			.then(() =>
			{
				return this._pc.createAnswer();
			})
			.then((answer) =>
			{
				logger.debug(
					'restartIce() | calling pc.setLocalDescription() [answer:%o]',
					answer);

				return this._pc.setLocalDescription(answer);
			});
	}

	_setupTransport()
	{
		logger.debug('_setupTransport()');

		return Promise.resolve()
			.then(() =>
			{
				// We need transport remote parameters.
				return this.safeEmitAsPromise('@needcreatetransport', null);
			})
			.then((transportRemoteParameters) =>
			{
				// Provide the remote SDP handler with transport remote parameters.
				this._remoteSdp.setTransportRemoteParameters(transportRemoteParameters);

				this._transportCreated = true;
			});
	}

	_updateTransport()
	{
		logger.debug('_updateTransport()');

		// Get our local DTLS parameters.
		// const transportLocalParameters = {};
		const sdp = this._pc.localDescription.sdp;
		const sdpObj = sdpTransform.parse(sdp);
		const dtlsParameters = sdpCommonUtils.extractDtlsParameters(sdpObj);
		const transportLocalParameters = { dtlsParameters };

		// We need to provide transport local parameters.
		this.safeEmit('@needupdatetransport', transportLocalParameters);

		this._transportUpdated = true;
	}
}
