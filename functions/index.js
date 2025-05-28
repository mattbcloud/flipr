const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');

initializeApp();

// Scheduled function - runs automatically every day at 2 AM UTC
exports.deleteExpiredPosts = onSchedule('0 2 * * *', async (event) => {
  console.log('🧹 Starting automatic cleanup of expired posts...');
  
  const database = getDatabase();
  const storage = getStorage();
  const bucket = storage.bucket();
  
  // Posts older than 7 days will be deleted
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  
  try {
    // Get all posts from the database
    const postsSnapshot = await database.ref('posts').once('value');
    const posts = postsSnapshot.val();
    
    if (!posts) {
      console.log('📭 No posts found in database');
      return { message: 'No posts found', deletedPosts: 0 };
    }
    
    const expiredPosts = [];
    const mediaToDelete = [];
    
    // Find posts that are older than 7 days
    for (const [postId, post] of Object.entries(posts)) {
      if (post.timestamp && post.timestamp < sevenDaysAgo) {
        expiredPosts.push(postId);
        
        // If the post has a video, collect the file path for deletion
        if (post.videoURL) {
          try {
            const url = new URL(post.videoURL);
            const filePath = decodeURIComponent(url.pathname.split('/o/')[1].split('?')[0]);
            mediaToDelete.push(filePath);
          } catch (error) {
            console.error('❌ Error parsing video URL for post', postId, ':', error);
          }
        }
        
        // Note: Images are stored as base64 in the database, so no separate file cleanup needed
      }
    }
    
    console.log(`📊 Found ${expiredPosts.length} expired posts to delete`);
    console.log(`🎥 Found ${mediaToDelete.length} video files to delete`);
    
    if (expiredPosts.length === 0) {
      console.log('✅ No expired posts found - cleanup complete');
      return { 
        message: 'No expired posts to delete', 
        deletedPosts: 0,
        deletedMediaFiles: 0
      };
    }
    
    // Delete posts from the database
    const postDeletePromises = expiredPosts.map(postId => {
      console.log(`🗑️ Deleting post: ${postId}`);
      return database.ref(`posts/${postId}`).remove();
    });
    
    // Delete video files from Firebase Storage
    const mediaDeletePromises = mediaToDelete.map(filePath => {
      console.log(`🎥 Deleting video file: ${filePath}`);
      return bucket.file(filePath).delete().catch(error => {
        console.error(`❌ Error deleting video file ${filePath}:`, error.message);
        // Don't fail the entire operation if one file deletion fails
      });
    });
    
    // Execute all deletions in parallel
    await Promise.all([...postDeletePromises, ...mediaDeletePromises]);
    
    console.log(`✅ Cleanup completed successfully!`);
    console.log(`   - Deleted ${expiredPosts.length} expired posts`);
    console.log(`   - Deleted ${mediaToDelete.length} video files`);
    console.log(`   - Freed up database and storage space`);
    
    return {
      success: true,
      message: `Successfully deleted ${expiredPosts.length} expired posts`,
      deletedPosts: expiredPosts.length,
      deletedMediaFiles: mediaToDelete.length,
      cleanupTime: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('💥 Error during automated cleanup:', error);
    
    // Return error details for logging
    return {
      success: false,
      error: error.message,
      cleanupTime: new Date().toISOString()
    };
  }
});