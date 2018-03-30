import Logger from '../Logger';
import * as ortc from '../ortc';
import { SendHandler, BaseRecvHandler, getNativeRtpCapabilities } from './Firefox';

const logger = new Logger('Firefox50');

class RecvHandler extends BaseRecvHandler
{
	constructor(rtpParametersByKind, settings)
	{
		super(rtpParametersByKind, settings);

		// Add an entry into consumers info to hold a fake DataChannel, so
		// the first m= section of the remote SDP is always "active" and Firefox
		// does not close the transport when there is no remote audio/video Consumers.
		//
		// ISSUE: https://github.com/versatica/mediasoup-client/issues/2
		const fakeDataChannelConsumerInfo =
		{
			mid    : 'fake-dc',
			kind   : 'application',
			closed : false,
			cname  : null
		};

		this._consumerInfos.set(555, fakeDataChannelConsumerInfo);
	}

	_getRemoteTrack(consumerInfo)
	{
		const newRtpReceiver = this._pc.getReceivers()
			.find((rtpReceiver) =>
			{
				const { track } = rtpReceiver;

				if (!track)
					return false;

				return track.id === consumerInfo.trackId;
			});

		if (!newRtpReceiver)
			throw new Error('remote track not found');

		return newRtpReceiver.track;
	}
}

export default class Firefox50
{
	static get tag()
	{
		return 'Firefox50';
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
