const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Scheduled function - runs automatically every day at 2 AM UTC
exports.deleteExpiredPosts = functions.pubsub.schedule('0 2 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log('🧹 Starting automatic cleanup of expired posts...');
    
    const database = admin.database();
    const storage = admin.storage();
    const bucket = storage.bucket();
    
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    try {
      const postsSnapshot = await database.ref('posts').once('value');
      const posts = postsSnapshot.val();
      
      if (!posts) {
        console.log('📭 No posts found in database');
        return { message: 'No posts found', deletedPosts: 0 };
      }
      
      const expiredPosts = [];
      const mediaToDelete = [];
      
      for (const [postId, post] of Object.entries(posts)) {
        if (post.timestamp && post.timestamp < sevenDaysAgo) {
          expiredPosts.push(postId);
          
          if (post.videoURL) {
            try {
              const url = new URL(post.videoURL);
              const filePath = decodeURIComponent(url.pathname.split('/o/')[1].split('?')[0]);
              mediaToDelete.push(filePath);
            } catch (error) {
              console.error('❌ Error parsing video URL for post', postId, ':', error);
            }
          }
        }
      }
      
      console.log(`📊 Found ${expiredPosts.length} expired posts to delete`);
      
      if (expiredPosts.length === 0) {
        console.log('✅ No expired posts found - cleanup complete');
        return { message: 'No expired posts to delete', deletedPosts: 0 };
      }
      
      const postDeletePromises = expiredPosts.map(postId => {
        console.log(`🗑️ Deleting post: ${postId}`);
        return database.ref(`posts/${postId}`).remove();
      });
      
      const mediaDeletePromises = mediaToDelete.map(filePath => {
        console.log(`🎥 Deleting video file: ${filePath}`);
        return bucket.file(filePath).delete().catch(error => {
          console.error(`❌ Error deleting video file ${filePath}:`, error.message);
        });
      });
      
      await Promise.all([...postDeletePromises, ...mediaDeletePromises]);
      
      console.log(`✅ Cleanup completed successfully!`);
      console.log(`   - Deleted ${expiredPosts.length} expired posts`);
      console.log(`   - Deleted ${mediaToDelete.length} video files`);
      
      return {
        success: true,
        message: `Successfully deleted ${expiredPosts.length} expired posts`,
        deletedPosts: expiredPosts.length,
        deletedMediaFiles: mediaToDelete.length,
        cleanupTime: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('💥 Error during automated cleanup:', error);
      return {
        success: false,
        error: error.message,
        cleanupTime: new Date().toISOString()
      };
    }
  });