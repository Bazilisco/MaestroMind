const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const SpotifyWebApi = require('spotify-web-api-node');
const scdl = require('soundcloud-downloader').default;
const ffmpegPath = require('ffmpeg-static');

const DISCORD_TOKEN = 'MTI3MDY0NjE4MzY2NDI4Nzg1NQ.GMfKR-.S1_DltgvIzy2gaZhYtvoZqSXTeauHtgj0YbJ3A';
const SPOTIFY_CLIENT_ID = 'dac5cf03a11f402a9a4deaeeaa5b53f2';
const SPOTIFY_CLIENT_SECRET = '6af4b8e09cb24261b81f72bb58538eac';

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates]
});

const spotifyApi = new SpotifyWebApi({
    clientId: SPOTIFY_CLIENT_ID,
    clientSecret: SPOTIFY_CLIENT_SECRET
});

async function getSpotifyToken() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log('Token do Spotify obtido com sucesso');
        return data.body['access_token'];
    } catch (error) {
        console.error('Erro ao obter o token do Spotify', error);
    }
}

let spotifyAccessToken;
let player;
let connection;
let queue = [];
let currentTrack = null;

client.once('ready', async () => {
    spotifyAccessToken = await getSpotifyToken();
    console.log(`Logged in as ${client.user.tag}!`);
});

async function refreshSpotifyToken() {
    spotifyAccessToken = await getSpotifyToken();
}

setInterval(refreshSpotifyToken, 3300000);

async function playNext() {
    if (queue.length === 0) {
        connection.destroy();
        return;
    }

    currentTrack = queue.shift();
    let resource;

    try {
        if (currentTrack.type === 'yt_video') {
            const stream = await play.stream(currentTrack.url, { quality: 2, ffmpegPath: ffmpegPath });
            resource = createAudioResource(stream.stream, { inputType: stream.type });
        } else if (currentTrack.type === 'spotify') {
            const yt_url = await play.search(currentTrack.info.name, { limit: 1, source: { youtube: 'video' } });
            const stream = await play.stream(yt_url[0].url, { quality: 2, ffmpegPath: ffmpegPath });
            resource = createAudioResource(stream.stream, { inputType: stream.type });
        } else if (currentTrack.type === 'soundcloud') {
            const stream = await scdl.download(currentTrack.url);
            resource = createAudioResource(stream);
        }

        player.play(resource);
        connection.subscribe(player);

        currentTrack.message.reply(`Tocando agora: ${currentTrack.url}`);
    } catch (error) {
        console.error('Erro ao tentar obter o stream:', error.message);
        console.error('Detalhes do erro:', error);
        currentTrack.message.reply('Ocorreu um erro ao tentar tocar a música.');
        playNext();
    }
}

client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.reply('Pong!');
    }

    if (message.content.startsWith('!bplay')) {
        const args = message.content.split(' ');
        const url = args[1];

        if (!url) {
            return message.reply('Você precisa fornecer uma URL!');
        }

        if (message.member.voice.channel) {
            if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
                connection = joinVoiceChannel({
                    channelId: message.member.voice.channel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                player = createAudioPlayer();

                connection.on(VoiceConnectionStatus.Ready, async () => {
                    console.log('Conexão de voz estabelecida.');
                    try {
                        await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
                    } catch (error) {
                        console.error('Falha ao conectar ao canal de voz:', error);
                        connection.destroy();
                    }
                });

                connection.on(VoiceConnectionStatus.Disconnected, () => {
                    console.log('Conexão de voz desconectada.');
                    connection.destroy();
                    message.reply('Desconectado do canal de voz.');
                });
            }

            try {
                const validation = await play.validate(url);
                if (validation === 'yt_video' || validation === 'yt_playlist') {
                    queue.push({ type: 'yt_video', url: url, message: message });
                } else if (validation === 'sp_track') {
                    const spotifyInfo = await play.spotify(url, { token: spotifyAccessToken });
                    queue.push({ type: 'spotify', url: url, info: spotifyInfo, message: message });
                } else if (validation === 'sc_track') {
                    queue.push({ type: 'soundcloud', url: url, message: message });
                } else {
                    throw new Error('URL não suportada.');
                }

                message.reply(`Música adicionada à fila: ${url}`);
                if (player.state.status !== AudioPlayerStatus.Playing) {
                    playNext();
                }
            } catch (error) {
                console.error('Erro ao tentar obter o stream:', error.message);
                console.error('Detalhes do erro:', error);
                message.reply('Ocorreu um erro ao tentar obter o stream.');
            }
        } else {
            message.reply('Você precisa estar em um canal de voz para tocar música!');
        }
    }

    if (message.content === '!bpause') {
        if (player) {
            player.pause();
            message.reply('Música pausada.');
        } else {
            message.reply('Nenhuma música está tocando no momento.');
        }
    }

    if (message.content === '!bresume') {
        if (player) {
            player.unpause();
            message.reply('Música retomada.');
        } else {
            message.reply('Nenhuma música está tocando no momento.');
        }
    }

    if (message.content === '!bstop') {
        if (player) {
            player.stop();
            connection.destroy();
            message.reply('Música parada e bot desconectado.');
        } else {
            message.reply('Nenhuma música está tocando no momento.');
        }
    }

    if (message.content === '!bskip') {
        if (player && player.state.status === AudioPlayerStatus.Playing) {
            message.reply('Pulando a música atual...');
            playNext();
        } else {
            message.reply('Nenhuma música está tocando no momento.');
        }
    }

    if (message.content === '!bclear') {
        queue = [];
        if (player) {
            player.stop();
            message.reply('Fila de músicas limpa.');
        } else {
            message.reply('Nenhuma música está tocando no momento.');
        }
    }

    if (message.content === '!bqueue') {
        if (queue.length === 0) {
            message.reply('A fila está vazia.');
        } else {
            const queueMessage = queue.map((track, index) => `${index + 1}. ${track.url}`).join('\n');
            message.reply(`Fila de músicas:\n${queueMessage}`);
        }
    }
});

client.login(DISCORD_TOKEN);