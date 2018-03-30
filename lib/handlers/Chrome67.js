import sdpTransform from 'sdp-transform';
import Logger from '../Logger';
import * as utils from '../utils';
import * as ortc from '../ortc';
import * as sdpCommonUtils from './sdp/commonUtils';
import * as sdpPlanBUtils from './sdp/planBUtils';
import { Handler, RecvHandler } from './Chrome';

const logger = new Logger('Chrome67');

class SendHandler extends Handler
{
	constructor(rtpParametersByKind, settings)
	{
		super('send', rtpParametersByKind, settings);

		// Got transport local and remote parameters.
		// @type {Boolean}
		this._transportReady = false;

		// Local stream.
		// @type {MediaStream}
		this._stream = new MediaStream();
	}

	addProducer(producer)
	{
		const { track } = producer;

		logger.debug(
			'addProducer() [id:%s, kind:%s, trackId:%s]',
			producer.id, producer.kind, track.id);

		if (this._stream.getTrackById(track.id))
			return Promise.reject(new Error('track already added'));

		let localSdpObj;

		return Promise.resolve()
			.then(() =>
			{
				// Add the track to the local stream.
				this._stream.addTrack(track);

				// Add the stream to the PeerConnection.
				this._pc.addStream(this._stream);

				return this._pc.createOffer();
			})
			.then((offer) =>
			{
				// If simulcast is set, mangle the offer.
				if (producer.simulcast)
				{
					logger.debug('addProducer() | enabling simulcast');

					const sdpObject = sdpTransform.parse(offer.sdp);

					sdpPlanBUtils.addSimulcastForTrack(sdpObject, track);

					const offerSdp = sdpTransform.write(sdpObject);

					offer = { type: 'offer', sdp: offerSdp };
				}

				logger.debug(
					'addProducer() | calling pc.setLocalDescription() [offer:%o]',
					offer);

				return this._pc.setLocalDescription(offer);
			})
			.then(() =>
			{
				if (!this._transportReady)
					return this._setupTransport();
			})
			.then(() =>
			{
				localSdpObj = sdpTransform.parse(this._pc.localDescription.sdp);

				const remoteSdp = this._remoteSdp.createAnswerSdp(localSdpObj);
				const answer = { type: 'answer', sdp: remoteSdp };

				logger.debug(
					'addProducer() | calling pc.setRemoteDescription() [answer:%o]',
					answer);

				return this._pc.setRemoteDescription(answer);
			})
			.then(() =>
			{
				const rtpParameters = utils.clone(this._rtpParametersByKind[producer.kind]);

				// Fill the RTP parameters for this track.
				sdpPlanBUtils.fillRtpParametersForTrack(
					rtpParameters, localSdpObj, track);

				return rtpParameters;
			})
			.catch((error) =>
			{
				// Panic here. Try to undo things.

				this._stream.removeTrack(track);
				this._pc.addStream(this._stream);

				throw error;
			});
	}

	removeProducer(producer)
	{
		const { track } = producer;

		logger.debug(
			'removeProducer() [id:%s, kind:%s, trackId:%s]',
			producer.id, producer.kind, track.id);

		return Promise.resolve()
			.then(() =>
			{
				// Remove the track from the local stream.
				this._stream.removeTrack(track);

				// Add the stream to the PeerConnection.
				this._pc.addStream(this._stream);

				return this._pc.createOffer();
			})
			.then((offer) =>
			{
				logger.debug(
					'removeProducer() | calling pc.setLocalDescription() [offer:%o]',
					offer);

				return this._pc.setLocalDescription(offer);
			})
			.catch((error) =>
			{
				// NOTE: If there are no sending tracks, setLocalDescription() will fail with
				// "Failed to create channels". If so, ignore it.
				if (this._stream.getTracks().length === 0)
				{
					logger.warn(
						'removeProducer() | ignoring expected error due no sending tracks: %s',
						error.toString());

					return;
				}

				throw error;
			})
			.then(() =>
			{
				if (this._pc.signalingState === 'stable')
					return;

				const localSdpObj = sdpTransform.parse(this._pc.localDescription.sdp);
				const remoteSdp = this._remoteSdp.createAnswerSdp(localSdpObj);
				const answer = { type: 'answer', sdp: remoteSdp };

				logger.debug(
					'removeProducer() | calling pc.setRemoteDescription() [answer:%o]',
					answer);

				return this._pc.setRemoteDescription(answer);
			});
	}

	replaceProducerTrack(producer, track)
	{
		logger.debug(
			'replaceProducerTrack() [id:%s, kind:%s, trackId:%s]',
			producer.id, producer.kind, track.id);

		const oldTrack = producer.track;

		return Promise.resolve()
			.then(() =>
			{
				// Get the associated RTCRtpSender.
				const rtpSender = this._pc.getSenders()
					.find((s) => s.track === oldTrack);

				if (!rtpSender)
					throw new Error('local track not found');

				return rtpSender.replaceTrack(track);
			})
			.then(() =>
			{
				// Remove the old track from the local stream.
				this._stream.removeTrack(oldTrack);

				// Add the new track to the local stream.
				this._stream.addTrack(track);
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
				return this._pc.createOffer({ iceRestart: true });
			})
			.then((offer) =>
			{
				logger.debug(
					'restartIce() | calling pc.setLocalDescription() [offer:%o]',
					offer);

				return this._pc.setLocalDescription(offer);
			})
			.then(() =>
			{
				const localSdpObj = sdpTransform.parse(this._pc.localDescription.sdp);
				const remoteSdp = this._remoteSdp.createAnswerSdp(localSdpObj);
				const answer = { type: 'answer', sdp: remoteSdp };

				logger.debug(
					'restartIce() | calling pc.setRemoteDescription() [answer:%o]',
					answer);

				return this._pc.setRemoteDescription(answer);
			});
	}

	_setupTransport()
	{
		logger.debug('_setupTransport()');

		return Promise.resolve()
			.then(() =>
			{
				// Get our local DTLS parameters.
				const transportLocalParameters = {};
				const sdp = this._pc.localDescription.sdp;
				const sdpObj = sdpTransform.parse(sdp);
				const dtlsParameters = sdpCommonUtils.extractDtlsParameters(sdpObj);

				// Let's decide that we'll be DTLS server (because we can).
				dtlsParameters.role = 'server';

				transportLocalParameters.dtlsParameters = dtlsParameters;

				// Provide the remote SDP handler with transport local parameters.
				this._remoteSdp.setTransportLocalParameters(transportLocalParameters);

				// We need transport remote parameters.
				return this.safeEmitAsPromise(
					'@needcreatetransport', transportLocalParameters);
			})
			.then((transportRemoteParameters) =>
			{
				// Provide the remote SDP handler with transport remote parameters.
				this._remoteSdp.setTransportRemoteParameters(transportRemoteParameters);

				this._transportReady = true;
			});
	}
}

export default class Chrome67
{
	static get tag()
	{
		return 'Chrome67';
	}

	static getNativeRtpCapabilities()
	{
		logger.debug('getNativeRtpCapabilities()');

		const pc = new RTCPeerConnection(
			{
				iceServers         : [],
				iceTransportPolicy : 'all',
				bundlePolicy       : 'max-bundle',
				rtcpMuxPolicy      : 'require'
			});

		return pc.createOffer(
			{
				offerToReceiveAudio : true,
				offerToReceiveVideo : true
			})
			.then((offer) =>
			{
				try { pc.close(); }
				catch (error) {}

				const sdpObj = sdpTransform.parse(offer.sdp);
				const nativeRtpCapabilities = sdpCommonUtils.extractRtpCapabilities(sdpObj);

				return nativeRtpCapabilities;
			})
			.catch((error) =>
			{
				try { pc.close(); }
				catch (error2) {}

				throw error;
			});
	}

	constructor(direction, extendedRtpCapabilities, settings)
	{
		logger.debug(
			'constructor() [direction:%s, extendedRtpCapabilities:%o]',
			direction, extendedRtpCapabilities);

		let rtpParametersByKind;

		switch (direction)
		{
			case 'send':
			{
				rtpParametersByKind =
				{
					audio : ortc.getSendingRtpParameters('audio', extendedRtpCapabilities),
					video : ortc.getSendingRtpParameters('video', extendedRtpCapabilities)
				};

				return new SendHandler(rtpParametersByKind, settings);
			}
			case 'recv':
			{
				rtpParametersByKind =
				{
					audio : ortc.getReceivingFullRtpParameters('audio', extendedRtpCapabilities),
					video : ortc.getReceivingFullRtpParameters('video', extendedRtpCapabilities)
				};

				return new RecvHandler(rtpParametersByKind, settings);
			}
		}
	}
}
