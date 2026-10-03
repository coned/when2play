-- Tree share PNGs are only needed until the bot posts them. Since this
-- release the Worker nulls image_data when a share is acknowledged or
-- expires; this clears the images of rows that were finished before that.
UPDATE rally_tree_shares SET image_data = NULL WHERE delivered <> 0;
