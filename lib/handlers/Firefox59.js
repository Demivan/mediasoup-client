import Logger from '../Logger';
import * as ortc from '../ortc';
import { SendHandler, BaseRecvHandler, getNativeRtpCapabilities } from './Firefox';

const logger = new Logger('Firefox59');

class RecvHandler extends BaseRecvHandler
{
	constructor(rtpParametersByKind, settings)
	{
		super(rtpParametersByKind, settings);
	}

	_getRemoteTrack(consumerInfo)
	{
		const newTransceiver = this._pc.getTransceivers()
			.find((transceiver) =>
			{
				const { receiver } = transceiver;

				if (!receiver)
					return false;

				const { track } = receiver;

				if (!track)
					return false;

				return transceiver.mid === consumerInfo.mid;
			});

		if (!newTransceiver)
			throw new Error('remote track not found');

		return newTransceiver.receiver.track;
	}
}

export default class Firefox59
{
	static get tag()
	{
		return 'Firefox59';
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
