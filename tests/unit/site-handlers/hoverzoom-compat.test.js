describe('Hover Zoom compatibility', () => {
  let manager;
  let previousHandler;

  beforeEach(() => {
    manager = window.VSC.siteHandlerManager;
    previousHandler = manager.currentHandler;
    manager.currentHandler = new window.VSC.BaseSiteHandler();
  });

  afterEach(() => {
    manager.currentHandler = previousHandler;
    document.querySelectorAll('#hzViewer, [data-test-gif-video]').forEach((node) => node.remove());
  });

  function createGifLikeVideo() {
    const video = document.createElement('video');
    video.dataset.testGifVideo = 'true';
    video.loop = true;
    video.muted = true;
    video.controls = false;
    return video;
  }

  it('continues to ignore ordinary muted looping videos without controls', () => {
    const video = createGifLikeVideo();
    document.body.appendChild(video);

    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });

  it('accepts a muted looping preview directly inside the Hover Zoom viewer', () => {
    const viewer = document.createElement('div');
    viewer.id = 'hzViewer';
    const video = createGifLikeVideo();
    viewer.appendChild(video);
    document.body.appendChild(viewer);

    expect(manager.shouldIgnoreVideo(video)).toBe(false);
  });

  it("accepts a muted looping preview inside Hover Zoom's rebuilt container", () => {
    const viewer = document.createElement('div');
    viewer.id = 'hzViewer';
    const container = document.createElement('div');
    container.id = 'hzContainer';
    const video = createGifLikeVideo();
    container.appendChild(video);
    viewer.appendChild(container);
    document.body.appendChild(viewer);

    expect(manager.shouldIgnoreVideo(video)).toBe(false);
  });

  it('pairs exactly one video and one audio in the same Hover Zoom viewer', () => {
    const viewer = document.createElement('div');
    viewer.id = 'hzViewer';
    const video = document.createElement('video');
    const audio = document.createElement('audio');
    viewer.append(video, audio);
    document.body.appendChild(viewer);

    expect(manager.getSynchronizedMediaGroup(video)).toEqual({
      viewer,
      primary: video,
      secondary: audio,
      media: [video, audio],
    });
    expect(manager.getSynchronizedMediaGroup(audio)?.primary).toBe(video);
  });

  it("pairs split media inside Hover Zoom's rebuilt container", () => {
    const viewer = document.createElement('div');
    viewer.id = 'hzViewer';
    const container = document.createElement('div');
    container.id = 'hzContainer';
    const video = document.createElement('video');
    const audio = document.createElement('audio');
    container.append(video, audio);
    viewer.appendChild(container);
    document.body.appendChild(viewer);

    expect(manager.getSynchronizedMediaGroup(video)?.media).toEqual([video, audio]);
  });

  it('does not pair ambiguous media or media from separate viewers', () => {
    const firstViewer = document.createElement('div');
    firstViewer.id = 'hzViewer';
    const firstVideo = document.createElement('video');
    const firstAudio = document.createElement('audio');
    const extraAudio = document.createElement('audio');
    firstViewer.append(firstVideo, firstAudio, extraAudio);

    const secondViewer = document.createElement('div');
    secondViewer.id = 'hzViewer';
    const secondVideo = document.createElement('video');
    secondViewer.appendChild(secondVideo);
    document.body.append(firstViewer, secondViewer);

    expect(manager.getSynchronizedMediaGroup(firstVideo)).toBeNull();
    expect(manager.getSynchronizedMediaGroup(secondVideo)).toBeNull();
  });
});
