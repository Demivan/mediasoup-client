import Logger from '../Logger';
import * as ortc from '../ortc';
import { BaseSendHandler, RecvHandler, getNativeRtpCapabilities } from './Chrome';

const logger = new Logger('Chrome67');

class SendHandler extends BaseSendHandler
{
	constructor(rtpParametersByKind, settings)
	{
		super(rtpParametersByKind, settings);
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
}

export default class Chrome67
{
	static get tag()
	{
		return 'Chrome67';
	}

	static getNativeRtpCapabilities()
	{
		return getNativeRtpCapabilities();
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
